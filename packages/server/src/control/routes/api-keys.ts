import { ApiKeyQuerySchema, CreateApiKeyInputSchema, UpdateApiKeyInputSchema } from "../types";
import type { ControlRouteContext } from "./common";
import { notFound, parseJsonBody, requireProject } from "./common";

export function registerApiKeyRoutes({ app, projects, store }: ControlRouteContext): void {
  const apiKeys = store.apiKeys;

  app.post("/v1/projects/:projectId/api-keys", async (c) => {
    const projectId = c.req.param("projectId");
    await requireProject(projects, projectId);
    const body = await parseJsonBody(c);
    const apiKey = await apiKeys.create(CreateApiKeyInputSchema.parse({ ...body, projectId }));
    return c.json(apiKey, 201);
  });

  app.get("/v1/projects/:projectId/api-keys", async (c) => {
    const projectId = c.req.param("projectId");
    await requireProject(projects, projectId);
    const query = ApiKeyQuerySchema.parse({
      search: c.req.query("search") || undefined,
      limit: c.req.query("limit") || undefined,
      offset: c.req.query("offset") || undefined,
    });
    return c.json(await apiKeys.list(projectId, query));
  });

  app.get("/v1/projects/:projectId/api-keys/:keyId", async (c) => {
    const { projectId, keyId } = c.req.param();
    const apiKey = await apiKeys.get(projectId, keyId);
    if (!apiKey) notFound("API key", keyId, "API_KEY_NOT_FOUND");
    return c.json(apiKey);
  });

  app.patch("/v1/projects/:projectId/api-keys/:keyId", async (c) => {
    const { projectId, keyId } = c.req.param();
    const body = UpdateApiKeyInputSchema.parse(await parseJsonBody(c));
    return c.json(await apiKeys.update(projectId, keyId, body));
  });

  app.delete("/v1/projects/:projectId/api-keys/:keyId", async (c) => {
    const { projectId, keyId } = c.req.param();
    if (!(await apiKeys.get(projectId, keyId))) {
      notFound("API key", keyId, "API_KEY_NOT_FOUND");
    }
    await apiKeys.delete(projectId, keyId);
    return c.json({ deleted: true }, 200);
  });
}
