import {
  AppendMessageInputSchema,
  ConversationQuerySchema,
  CreateConversationInputSchema,
  MessageQuerySchema,
  UpdateConversationInputSchema,
  UpdateMessageInputSchema,
} from "../types";
import {
  createConversationService,
  SendConversationMessageInputSchema,
} from "../conversation-service";
import type { ControlRouteContext } from "./common";
import { notFound, parseJsonBody, requireProject, sha256 } from "./common";
import { IdempotencyConflictError } from "../../errors";

export function registerConversationRoutes({
  app,
  weysabi,
  projects,
  store,
  idempotency,
  quotaStore,
  quotaConfig,
  ragService,
}: ControlRouteContext): void {
  const conversations = store.conversations;
  const conversationService = createConversationService(
    weysabi,
    store,
    quotaStore ? { store: quotaStore, config: quotaConfig } : undefined,
    ragService
  );

  app.post("/v1/projects/:projectId/conversations", async (c) => {
    const projectId = c.req.param("projectId");
    await requireProject(projects, projectId);
    const body = await parseJsonBody(c);
    const conversation = await conversations.createConversation(
      CreateConversationInputSchema.parse({ ...body, projectId })
    );
    return c.json(conversation, 201);
  });

  app.get("/v1/projects/:projectId/conversations", async (c) => {
    const projectId = c.req.param("projectId");
    await requireProject(projects, projectId);
    const query = ConversationQuerySchema.parse({
      search: c.req.query("search") || undefined,
      externalUserId: c.req.query("externalUserId") || undefined,
      status: c.req.query("status") || undefined,
      limit: c.req.query("limit") || undefined,
      offset: c.req.query("offset") || undefined,
    });
    return c.json(await conversations.listConversations(projectId, query));
  });

  app.get("/v1/projects/:projectId/conversations/:conversationId", async (c) => {
    const { projectId, conversationId } = c.req.param();
    const conversation = await conversations.getConversation(projectId, conversationId);
    if (!conversation) notFound("Conversation", conversationId, "CONVERSATION_NOT_FOUND");
    return c.json(conversation);
  });

  app.patch("/v1/projects/:projectId/conversations/:conversationId", async (c) => {
    const { projectId, conversationId } = c.req.param();
    const body = UpdateConversationInputSchema.parse(await parseJsonBody(c));
    return c.json(await conversations.updateConversation(projectId, conversationId, body));
  });

  app.delete("/v1/projects/:projectId/conversations/:conversationId", async (c) => {
    const { projectId, conversationId } = c.req.param();
    if (!(await conversations.getConversation(projectId, conversationId))) {
      notFound("Conversation", conversationId, "CONVERSATION_NOT_FOUND");
    }
    await conversations.deleteConversation(projectId, conversationId);
    return c.json({ deleted: true }, 200);
  });

  app.post("/v1/projects/:projectId/conversations/:conversationId/messages", async (c) => {
    const { projectId, conversationId } = c.req.param();
    if (!(await conversations.getConversation(projectId, conversationId))) {
      notFound("Conversation", conversationId, "CONVERSATION_NOT_FOUND");
    }
    const body = await parseJsonBody(c);
    const message = await conversations.appendMessage(
      AppendMessageInputSchema.parse({ ...body, projectId, conversationId })
    );
    return c.json(message, 201);
  });

  app.post("/v1/projects/:projectId/conversations/:conversationId/messages/send", async (c) => {
    const { projectId, conversationId } = c.req.param();
    const body = await parseJsonBody(c);
    const input = SendConversationMessageInputSchema.parse({
      ...body,
      projectId,
      conversationId,
    });
    const rawIdempotencyKey = c.req.header("Idempotency-Key");
    const idempotencyStore = idempotency;
    const [idempotencyKey, requestFingerprint] =
      idempotencyStore && rawIdempotencyKey
        ? await Promise.all([
            sha256(
              `${c.req.header("Authorization") ?? "anonymous"}:${c.req.method}:${c.req.path}:${rawIdempotencyKey}`
            ),
            sha256(JSON.stringify(input)),
          ])
        : [undefined, undefined];

    if (idempotencyKey && idempotencyStore) {
      const cached = (await idempotencyStore.getResponse(idempotencyKey)) as
        | { fingerprint: string; response: unknown }
        | undefined;
      if (cached) {
        if (cached.fingerprint !== requestFingerprint) {
          throw new IdempotencyConflictError();
        }
        return c.json(cached.response, 200);
      }
    }

    const result = await conversationService.sendMessage(input);
    if (idempotencyKey && requestFingerprint) {
      await idempotencyStore?.setResponse(idempotencyKey, {
        fingerprint: requestFingerprint,
        response: result,
      });
    }
    return c.json(result, 201);
  });

  app.post("/v1/projects/:projectId/conversations/:conversationId/messages/stream", async (c) => {
    const { projectId, conversationId } = c.req.param();
    const body = await parseJsonBody(c);
    const events = conversationService.streamMessage(
      SendConversationMessageInputSchema.parse({ ...body, projectId, conversationId })
    );
    const encoder = new TextEncoder();

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            for await (const event of events) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "error", error: { message } })}\n\n`)
            );
          } finally {
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
  });

  app.get("/v1/projects/:projectId/conversations/:conversationId/messages", async (c) => {
    const { projectId, conversationId } = c.req.param();
    if (!(await conversations.getConversation(projectId, conversationId))) {
      notFound("Conversation", conversationId, "CONVERSATION_NOT_FOUND");
    }
    const query = MessageQuerySchema.parse({
      limit: c.req.query("limit") || undefined,
      offset: c.req.query("offset") || undefined,
    });
    return c.json(await conversations.listMessages(projectId, conversationId, query));
  });

  app.patch("/v1/projects/:projectId/messages/:messageId", async (c) => {
    const { projectId, messageId } = c.req.param();
    const body = UpdateMessageInputSchema.parse(await parseJsonBody(c));
    return c.json(await conversations.updateMessage(projectId, messageId, body));
  });
}
