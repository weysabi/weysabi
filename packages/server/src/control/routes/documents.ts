import { z } from "zod";
import { CreateDocumentInputSchema, DocumentQuerySchema } from "../types";
import type { ControlRouteContext } from "./common";
import { notFound, parseJsonBody, requireProject } from "./common";

const UpdateDocumentStatusBodySchema = z.object({
  status: z.enum(["pending", "indexing", "ready", "failed"]),
});

const ReindexDocumentBodySchema = z.object({
  content: z.string().min(1),
  name: z.string().optional(),
});

export function registerDocumentRoutes({
  app,
  projects,
  store,
  ragService,
}: ControlRouteContext): void {
  const documents = store.documents;

  app.post("/v1/projects/:projectId/documents", async (c) => {
    const projectId = c.req.param("projectId");
    await requireProject(projects, projectId);
    const body = await parseJsonBody(c);
    const document = await documents.create(
      CreateDocumentInputSchema.parse({ ...body, projectId })
    );
    return c.json(document, 201);
  });

  app.get("/v1/projects/:projectId/documents", async (c) => {
    const projectId = c.req.param("projectId");
    await requireProject(projects, projectId);
    const query = DocumentQuerySchema.parse({
      search: c.req.query("search") || undefined,
      status: c.req.query("status") || undefined,
      sourceType: c.req.query("sourceType") || undefined,
      limit: c.req.query("limit") || undefined,
      offset: c.req.query("offset") || undefined,
    });
    return c.json(await documents.list(projectId, query));
  });

  app.get("/v1/projects/:projectId/documents/:documentId", async (c) => {
    const { projectId, documentId } = c.req.param();
    const document = await documents.get(projectId, documentId);
    if (!document) notFound("Document", documentId, "DOCUMENT_NOT_FOUND");
    return c.json(document);
  });

  app.patch("/v1/projects/:projectId/documents/:documentId/status", async (c) => {
    const { projectId, documentId } = c.req.param();
    const body = UpdateDocumentStatusBodySchema.parse(await parseJsonBody(c));
    return c.json(await documents.updateStatus(projectId, documentId, body.status));
  });

  app.delete("/v1/projects/:projectId/documents/:documentId", async (c) => {
    const { projectId, documentId } = c.req.param();
    if (!(await documents.get(projectId, documentId))) {
      notFound("Document", documentId, "DOCUMENT_NOT_FOUND");
    }
    if (ragService) {
      const engine = ragService.project(projectId);
      engine.clear(documentId);
    }
    await documents.delete(projectId, documentId);
    return c.json({ deleted: true }, 200);
  });

  app.post("/v1/projects/:projectId/documents/:documentId/reindex", async (c) => {
    const { projectId, documentId } = c.req.param();
    await requireProject(projects, projectId);
    const document = await documents.get(projectId, documentId);
    if (!document) notFound("Document", documentId, "DOCUMENT_NOT_FOUND");
    if (!ragService) {
      return c.json({ error: "RAG is not configured" }, 400);
    }
    const body = ReindexDocumentBodySchema.parse(await parseJsonBody(c));
    await documents.updateStatus(projectId, documentId, "indexing");
    const engine = ragService.project(projectId);
    try {
      const results = await engine.load({
        name: body.name ?? document!.name,
        content: body.content,
      });
      const totalChunks = results.reduce((sum, r) => sum + r.chunks, 0);
      const updated = await documents.updateStatus(projectId, documentId, "ready");
      return c.json({ ...updated, chunksLoaded: totalChunks }, 200);
    } catch (error) {
      await documents.updateStatus(projectId, documentId, "failed");
      throw error;
    }
  });
}
