import {
  CreateRunInputSchema,
  RunQuerySchema,
  RunStatsQuerySchema,
  UpdateRunInputSchema,
} from "../types";
import type { ControlRouteContext } from "./common";
import { notFound, parseJsonBody, requireProject } from "./common";

export function registerRunRoutes({ app, projects, store }: ControlRouteContext): void {
  const runs = store.runs;

  app.post("/v1/projects/:projectId/runs", async (c) => {
    const projectId = c.req.param("projectId");
    await requireProject(projects, projectId);
    const body = await parseJsonBody(c);
    const run = await runs.create(CreateRunInputSchema.parse({ ...body, projectId }));
    return c.json(run, 201);
  });

  app.get("/v1/projects/:projectId/runs", async (c) => {
    const projectId = c.req.param("projectId");
    await requireProject(projects, projectId);
    const query = RunQuerySchema.parse({
      search: c.req.query("search") || undefined,
      conversationId: c.req.query("conversationId") || undefined,
      promptId: c.req.query("promptId") || undefined,
      status: c.req.query("status") || undefined,
      limit: c.req.query("limit") || undefined,
      offset: c.req.query("offset") || undefined,
    });
    return c.json(await runs.list(projectId, query));
  });

  app.get("/v1/projects/:projectId/runs/stats", async (c) => {
    const projectId = c.req.param("projectId");
    await requireProject(projects, projectId);
    const query = RunStatsQuerySchema.parse({
      from: c.req.query("from") ? Number(c.req.query("from")) : undefined,
      to: c.req.query("to") ? Number(c.req.query("to")) : undefined,
    });
    return c.json(await runs.stats(projectId, query));
  });

  app.get("/v1/projects/:projectId/runs/:runId", async (c) => {
    const { projectId, runId } = c.req.param();
    const run = await runs.get(projectId, runId);
    if (!run) notFound("Run", runId, "RUN_NOT_FOUND");
    return c.json(run);
  });

  app.patch("/v1/projects/:projectId/runs/:runId", async (c) => {
    const { projectId, runId } = c.req.param();
    const body = UpdateRunInputSchema.parse(await parseJsonBody(c));
    return c.json(await runs.update(projectId, runId, body));
  });
}
