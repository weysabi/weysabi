import { z } from "zod";
import { CreateDocumentInputSchema, DocumentQuerySchema } from "../types";
import type { ControlRouteContext, HonoApp } from "./common";
import { notFound, parseJsonBody, requireProject } from "./common";

const UpdateDocumentStatusBodySchema = z.object({
  status: z.enum(["pending", "indexing", "ready", "failed"]),
});

export function registerDocumentRoutes({ app, projects, store }: ControlRouteContext): void {
  const documents = store.documents;

  app.post("/v1/projects/:projectId/documents", async (c: HonoApp) => {
    const projectId = c.req.param("projectId");
    await requireProject(projects, projectId);
    const body = await parseJsonBody(c);
    const document = await documents.create(
      CreateDocumentInputSchema.parse({ ...body, projectId })
    );
    return c.json(document, 201);
  });

  app.get("/v1/projects/:projectId/documents", async (c: HonoApp) => {
    const projectId = c.req.param("projectId");
    await requireProject(projects, projectId);
    const query = DocumentQuerySchema.parse({
      status: c.req.query("status") || undefined,
      sourceType: c.req.query("sourceType") || undefined,
      limit: c.req.query("limit") || undefined,
      offset: c.req.query("offset") || undefined,
    });
    return c.json(await documents.list(projectId, query));
  });

  app.get("/v1/projects/:projectId/documents/:documentId", async (c: HonoApp) => {
    const { projectId, documentId } = c.req.param();
    const document = await documents.get(projectId, documentId);
    if (!document) notFound("Document", documentId, "DOCUMENT_NOT_FOUND");
    return c.json(document);
  });

  app.patch("/v1/projects/:projectId/documents/:documentId/status", async (c: HonoApp) => {
    const { projectId, documentId } = c.req.param();
    const body = UpdateDocumentStatusBodySchema.parse(await parseJsonBody(c));
    return c.json(await documents.updateStatus(projectId, documentId, body.status));
  });

  app.delete("/v1/projects/:projectId/documents/:documentId", async (c: HonoApp) => {
    const { projectId, documentId } = c.req.param();
    if (!(await documents.get(projectId, documentId))) {
      notFound("Document", documentId, "DOCUMENT_NOT_FOUND");
    }
    await documents.delete(projectId, documentId);
    return c.json({ deleted: true }, 200);
  });
}
