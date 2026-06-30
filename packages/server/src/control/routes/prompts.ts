import { z } from "zod";
import type { CompleteRequest, StreamRequest } from "weysabi";
import { ControlError, errorMessage } from "../errors";
import type { ControlRouteContext } from "./common";
import { notFound, parseJsonBody, requireProject } from "./common";
import { renderMessages } from "../templates";

const ExecutePromptBodySchema = z.object({
  inputs: z.record(z.string(), z.unknown()).default({}),
  model: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  fallbacks: z.array(z.string().min(1)).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
});

export function registerPromptRoutes({
  app,
  weysabi,
  projects,
  prompts,
}: ControlRouteContext): void {
  app.post("/v1/projects/:projectId/prompts", async (c) => {
    const projectId = c.req.param("projectId");
    await requireProject(projects, projectId);
    const body = await parseJsonBody(c);
    const prompt = await prompts.create({ ...body, projectId });
    return c.json(prompt, 201);
  });

  app.get("/v1/projects/:projectId/prompts", async (c) => {
    const projectId = c.req.param("projectId");
    const search = c.req.query("search") || undefined;
    const limit = c.req.query("limit") || undefined;
    const offset = c.req.query("offset") || undefined;
    const result = await prompts.list(projectId, { search, limit, offset });
    return c.json(result);
  });

  app.get("/v1/projects/:projectId/prompts/:promptId", async (c) => {
    const { projectId, promptId } = c.req.param();
    const prompt = await prompts.get(projectId, promptId);
    if (!prompt) notFound("Prompt", promptId, "PROMPT_NOT_FOUND");
    return c.json(prompt);
  });

  app.patch("/v1/projects/:projectId/prompts/:promptId", async (c) => {
    const { projectId, promptId } = c.req.param();
    const body = await parseJsonBody(c);
    const prompt = await prompts.update(projectId, promptId, body);
    return c.json(prompt);
  });

  app.delete("/v1/projects/:projectId/prompts/:promptId", async (c) => {
    const { projectId, promptId } = c.req.param();
    if (!(await prompts.get(projectId, promptId))) {
      notFound("Prompt", promptId, "PROMPT_NOT_FOUND");
    }
    await prompts.delete(projectId, promptId);
    return c.json({ deleted: true }, 200);
  });

  app.post("/v1/projects/:projectId/prompts/:promptId/versions", async (c) => {
    const { projectId, promptId } = c.req.param();
    if (!(await prompts.get(projectId, promptId))) {
      notFound("Prompt", promptId, "PROMPT_NOT_FOUND");
    }
    const body = await parseJsonBody(c);
    const version = await prompts.createVersion({ projectId, promptId, ...body });
    return c.json(version, 201);
  });

  app.get("/v1/projects/:projectId/prompts/:promptId/versions", async (c) => {
    const { projectId, promptId } = c.req.param();
    const limit = c.req.query("limit") || undefined;
    const offset = c.req.query("offset") || undefined;
    const result = await prompts.listVersions(projectId, promptId, { limit, offset });
    return c.json(result);
  });

  app.get("/v1/projects/:projectId/prompts/:promptId/versions/:versionId", async (c) => {
    const { projectId, versionId } = c.req.param();
    const version = await prompts.getVersion(projectId, versionId);
    if (!version) notFound("Prompt version", versionId, "PROMPT_VERSION_NOT_FOUND");
    return c.json(version);
  });

  app.post("/v1/projects/:projectId/prompts/:promptId/versions/:versionId/publish", async (c) => {
    const { projectId, promptId, versionId } = c.req.param();
    const result = await prompts.publishVersion(projectId, promptId, versionId);
    return c.json(result);
  });

  app.post("/v1/projects/:projectId/prompts/:promptId/execute", async (c) => {
    const { projectId, promptId } = c.req.param();
    const prompt = await prompts.get(projectId, promptId);
    if (!prompt) notFound("Prompt", promptId, "PROMPT_NOT_FOUND");
    if (!prompt.publishedVersionId) {
      throw new ControlError(
        `Prompt "${promptId}" has no published version`,
        "PROMPT_NOT_PUBLISHED",
        400
      );
    }
    const version = await prompts.getVersion(projectId, prompt.publishedVersionId);
    if (!version) {
      throw new ControlError(
        `Published version "${prompt.publishedVersionId}" not found for prompt "${promptId}"`,
        "PROMPT_VERSION_NOT_FOUND",
        500
      );
    }

    const body = ExecutePromptBodySchema.parse(await parseJsonBody(c));
    const model = body.model ?? version.model;
    if (!model) {
      throw new ControlError(
        `Prompt "${promptId}" has no model. Configure a model on the published version or provide one when executing.`,
        "PROMPT_MODEL_REQUIRED",
        400
      );
    }
    const request: CompleteRequest = {
      messages: renderMessages(version.messages, body.inputs, `prompt:${promptId}`),
      model,
      fallbacks: body.fallbacks ?? version.fallbacks,
      temperature: body.temperature ?? version.temperature,
      maxTokens: body.maxTokens ?? version.maxTokens,
    };

    if (body.stream === true) {
      const iterable = weysabi.stream(request as StreamRequest);
      return new Response(
        new ReadableStream({
          async pull(controller) {
            try {
              for await (const chunk of iterable) {
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
              controller.close();
            } catch (err) {
              const msg = errorMessage(err);
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify({ error: { message: msg } })}\n\n`)
              );
              controller.close();
            }
          },
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }
      );
    }

    const result = await weysabi.complete(request);
    return c.json(result);
  });
}
