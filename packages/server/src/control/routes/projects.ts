import type { ControlRouteContext, HonoApp } from "./common";
import { notFound, parseJsonBody } from "./common";

export function registerProjectRoutes({ app, projects }: ControlRouteContext): void {
  app.post("/v1/projects", async (c: HonoApp) => {
    const body = await parseJsonBody(c);
    const project = await projects.create(body);
    return c.json(project, 201);
  });

  app.get("/v1/projects", async (c: HonoApp) => {
    const limit = c.req.query("limit") || undefined;
    const offset = c.req.query("offset") || undefined;
    const result = await projects.list({ limit, offset });
    return c.json(result);
  });

  app.get("/v1/projects/:projectId", async (c: HonoApp) => {
    const projectId = c.req.param("projectId");
    const project = await projects.get(projectId);
    if (!project) notFound("Project", projectId, "PROJECT_NOT_FOUND");
    return c.json(project);
  });

  app.patch("/v1/projects/:projectId", async (c: HonoApp) => {
    const projectId = c.req.param("projectId");
    const body = await parseJsonBody(c);
    const project = await projects.update(projectId, body);
    return c.json(project);
  });

  app.delete("/v1/projects/:projectId", async (c: HonoApp) => {
    const projectId = c.req.param("projectId");
    if (!(await projects.get(projectId))) {
      notFound("Project", projectId, "PROJECT_NOT_FOUND");
    }
    await projects.delete(projectId);
    return c.json({ deleted: true }, 200);
  });
}
