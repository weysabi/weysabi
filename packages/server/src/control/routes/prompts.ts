import { z } from "zod";
import type { CompleteRequest, Message, StreamRequest } from "@weysabi/sabi";
import { ControlError } from "../errors";
import type { ControlRouteContext, HonoApp } from "./common";
import { notFound, parseJsonBody, requireProject } from "./common";

const TEMPLATE_REGEX = /\{(\w+)\}/g;

const ExecutePromptBodySchema = z.object({
  inputs: z.record(z.string(), z.unknown()).default({}),
  model: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  fallbacks: z.array(z.string().min(1)).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
});

function renderMessages(
  messages: Message[],
  inputs: Record<string, unknown>,
  promptId: string
): Message[] {
  return messages.map((message) => ({
    ...message,
    content:
      typeof message.content === "string"
        ? message.content.replace(TEMPLATE_REGEX, (_match, key: string) => {
            if (!(key in inputs)) {
              throw new ControlError(
                `Missing input "${key}" for prompt "${promptId}"`,
                "MISSING_PROMPT_INPUT",
                400
              );
            }
            return String(inputs[key]);
          })
        : message.content,
  }));
}

export function registerPromptRoutes({ app, sabi, projects, prompts }: ControlRouteContext): void {
  app.post("/v1/projects/:projectId/prompts", async (c: HonoApp) => {
    const projectId = c.req.param("projectId");
    await requireProject(projects, projectId);
    const body = await parseJsonBody(c);
    const prompt = await prompts.create({ ...body, projectId });
    return c.json(prompt, 201);
  });

  app.get("/v1/projects/:projectId/prompts", async (c: HonoApp) => {
    const projectId = c.req.param("projectId");
    const limit = c.req.query("limit") || undefined;
    const offset = c.req.query("offset") || undefined;
    const result = await prompts.list(projectId, { limit, offset });
    return c.json(result);
  });

  app.get("/v1/projects/:projectId/prompts/:promptId", async (c: HonoApp) => {
    const { projectId, promptId } = c.req.param();
    const prompt = await prompts.get(projectId, promptId);
    if (!prompt) notFound("Prompt", promptId, "PROMPT_NOT_FOUND");
    return c.json(prompt);
  });

  app.patch("/v1/projects/:projectId/prompts/:promptId", async (c: HonoApp) => {
    const { projectId, promptId } = c.req.param();
    const body = await parseJsonBody(c);
    const prompt = await prompts.update(projectId, promptId, body);
    return c.json(prompt);
  });

  app.delete("/v1/projects/:projectId/prompts/:promptId", async (c: HonoApp) => {
    const { projectId, promptId } = c.req.param();
    if (!(await prompts.get(projectId, promptId))) {
      notFound("Prompt", promptId, "PROMPT_NOT_FOUND");
    }
    await prompts.delete(projectId, promptId);
    return c.json({ deleted: true }, 200);
  });

  app.post("/v1/projects/:projectId/prompts/:promptId/versions", async (c: HonoApp) => {
    const { projectId, promptId } = c.req.param();
    if (!(await prompts.get(projectId, promptId))) {
      notFound("Prompt", promptId, "PROMPT_NOT_FOUND");
    }
    const body = await parseJsonBody(c);
    const version = await prompts.createVersion({ projectId, promptId, ...body });
    return c.json(version, 201);
  });

  app.get("/v1/projects/:projectId/prompts/:promptId/versions", async (c: HonoApp) => {
    const { projectId, promptId } = c.req.param();
    const limit = c.req.query("limit") || undefined;
    const offset = c.req.query("offset") || undefined;
    const result = await prompts.listVersions(projectId, promptId, { limit, offset });
    return c.json(result);
  });

  app.get("/v1/projects/:projectId/prompts/:promptId/versions/:versionId", async (c: HonoApp) => {
    const { projectId, versionId } = c.req.param();
    const version = await prompts.getVersion(projectId, versionId);
    if (!version) notFound("Prompt version", versionId, "PROMPT_VERSION_NOT_FOUND");
    return c.json(version);
  });

  app.post(
    "/v1/projects/:projectId/prompts/:promptId/versions/:versionId/publish",
    async (c: HonoApp) => {
      const { projectId, promptId, versionId } = c.req.param();
      const result = await prompts.publishVersion(projectId, promptId, versionId);
      return c.json(result);
    }
  );

  app.post("/v1/projects/:projectId/prompts/:promptId/execute", async (c: HonoApp) => {
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
    const model = version.model ?? body.model;
    if (!model) {
      throw new ControlError(
        `Prompt "${promptId}" has no model. Configure a model on the published version or provide one when executing.`,
        "PROMPT_MODEL_REQUIRED",
        400
      );
    }
    const request: CompleteRequest = {
      messages: renderMessages(version.messages, body.inputs, promptId),
      model,
      fallbacks: version.fallbacks ?? body.fallbacks,
      temperature: version.temperature ?? body.temperature,
      maxTokens: version.maxTokens ?? body.maxTokens,
    };

    if (body.stream === true) {
      const iterable = sabi.stream(request as StreamRequest);
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
              const message = err instanceof Error ? err.message : String(err);
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify({ error: { message } })}\n\n`)
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

    const result = await sabi.complete(request);
    return c.json(result);
  });
}
