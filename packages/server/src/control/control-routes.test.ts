import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createWeysabi, type CompleteRequest, type StreamRequest } from "@weysabi/sabi";
import { createRouter } from "../routes";
import { createSqliteControlPlaneStore } from "./sqlite-store";

type Router = { fetch: (req: Request) => Response | Promise<Response> };
type Store = Awaited<ReturnType<typeof createSqliteControlPlaneStore>>;

const ADMIN_API_KEY = "sk-admin";

function controlRequest(input: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("authorization")) {
    headers.set("authorization", `Bearer ${ADMIN_API_KEY}`);
  }
  return new Request(input, { ...init, headers });
}

function projectRequest(input: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(input, { ...init, headers });
}

describe("Control plane HTTP routes", () => {
  let store: Store;
  let router: Router;
  let projectId: string;
  let promptId: string;
  let completeRequests: CompleteRequest[];

  beforeAll(async () => {
    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    completeRequests = [];
    sabi.complete = (async (request: CompleteRequest) => {
      completeRequests.push(request);
      if (request.messages?.at(-1)?.content === "provider fails") {
        throw new Error("provider unavailable");
      }
      return {
        content: "ok",
        model: Array.isArray(request.model) ? request.model[0]! : request.model,
        provider: "test",
        latencyMs: 1,
        usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
      };
    }) as typeof sabi.complete;
    sabi.stream = async function* (request: StreamRequest) {
      const last = request.messages?.at(-1)?.content;
      yield { content: "he", done: false };
      if (last === "stream interrupts") {
        throw new Error("stream lost");
      }
      yield { content: "llo", done: false };
      yield {
        content: "",
        done: true,
        usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
      };
    } as typeof sabi.stream;
    store = await createSqliteControlPlaneStore(":memory:");
    router = await createRouter(sabi, {
      adminApiKey: ADMIN_API_KEY,
      controlPlaneStore: store,
    });
  });

  afterAll(async () => {
    await store.close();
  });

  describe("POST /v1/projects", () => {
    it("requires admin auth", async () => {
      const res = await router.fetch(
        new Request("http://localhost/v1/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Unauthorized", slug: "unauthorized" }),
        })
      );
      expect(res.status).toBe(401);
    });

    it("accepts the admin key when a separate chat API key is configured", async () => {
      const localStore = await createSqliteControlPlaneStore(":memory:");
      try {
        const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
        const localRouter = await createRouter(sabi, {
          apiKey: "sk-chat",
          adminApiKey: ADMIN_API_KEY,
          controlPlaneStore: localStore,
        });
        const res = await localRouter.fetch(
          controlRequest("http://localhost/v1/projects", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Admin Project", slug: "admin-project" }),
          })
        );
        expect(res.status).toBe(201);

        const chatKeyRes = await localRouter.fetch(
          new Request("http://localhost/v1/projects", {
            method: "POST",
            headers: {
              authorization: "Bearer sk-chat",
              "content-type": "application/json",
            },
            body: JSON.stringify({ name: "Chat Key Project", slug: "chat-key-project" }),
          })
        );
        expect(chatKeyRes.status).toBe(403);
      } finally {
        await localStore.close();
      }
    });

    it("creates a project", async () => {
      const res = await router.fetch(
        controlRequest("http://localhost/v1/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Test Project", slug: "test-project" }),
        })
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.name).toBe("Test Project");
      expect(body.slug).toBe("test-project");
      expect(typeof body.id).toBe("string");
      expect(typeof body.createdAt).toBe("number");
      projectId = body.id as string;
    });

    it("rejects invalid project input", async () => {
      const res = await router.fetch(
        controlRequest("http://localhost/v1/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "", slug: "" }),
        })
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects duplicate slug", async () => {
      const res = await router.fetch(
        controlRequest("http://localhost/v1/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Duplicate", slug: "test-project" }),
        })
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("PROJECT_SLUG_CONFLICT");
    });
  });

  describe("GET /v1/projects", () => {
    it("lists projects", async () => {
      const res = await router.fetch(controlRequest("http://localhost/v1/projects"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[]; total: number };
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(1);
    });

    it("supports pagination", async () => {
      const res = await router.fetch(
        controlRequest("http://localhost/v1/projects?limit=1&offset=0")
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[]; total: number };
      expect(body.items.length).toBeLessThanOrEqual(1);
    });
  });

  describe("GET /v1/projects/:projectId", () => {
    it("gets a project by id", async () => {
      const res = await router.fetch(controlRequest(`http://localhost/v1/projects/${projectId}`));
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.id).toBe(projectId);
      expect(body.name).toBe("Test Project");
    });

    it("returns 404 for unknown project", async () => {
      const res = await router.fetch(controlRequest("http://localhost/v1/projects/unknown-id"));
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("PROJECT_NOT_FOUND");
    });
  });

  describe("PATCH /v1/projects/:projectId", () => {
    it("updates a project", async () => {
      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Updated Project" }),
        })
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.name).toBe("Updated Project");
    });
  });

  describe("DELETE /v1/projects/:projectId", () => {
    it("deletes a project", async () => {
      // Create a temporary project to delete
      const createRes = await router.fetch(
        controlRequest("http://localhost/v1/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Temp", slug: "temp-to-delete" }),
        })
      );
      const created = (await createRes.json()) as Record<string, unknown>;
      const tempId = created.id as string;

      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${tempId}`, { method: "DELETE" })
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { deleted: boolean };
      expect(body.deleted).toBe(true);

      const getRes = await router.fetch(controlRequest(`http://localhost/v1/projects/${tempId}`));
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for deleting unknown project", async () => {
      const res = await router.fetch(
        controlRequest("http://localhost/v1/projects/unknown-id", { method: "DELETE" })
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /v1/projects/:projectId/prompts", () => {
    it("creates a prompt", async () => {
      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Test Prompt", slug: "test-prompt" }),
        })
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.name).toBe("Test Prompt");
      expect(body.slug).toBe("test-prompt");
      expect(body.projectId).toBe(projectId);
      expect(typeof body.id).toBe("string");
      promptId = body.id as string;
    });

    it("returns 404 when project does not exist", async () => {
      const res = await router.fetch(
        controlRequest("http://localhost/v1/projects/nonexistent/prompts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Orphan", slug: "orphan-prompt" }),
        })
      );
      expect(res.status).toBe(404);
    });

    it("rejects invalid prompt input", async () => {
      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "", slug: "" }),
        })
      );
      expect(res.status).toBe(400);
    });
  });

  describe("GET /v1/projects/:projectId/prompts", () => {
    it("lists prompts for a project", async () => {
      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts`)
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[]; total: number };
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GET /v1/projects/:projectId/prompts/:promptId", () => {
    it("gets a prompt by id", async () => {
      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts/${promptId}`)
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.id).toBe(promptId);
    });

    it("returns 404 for unknown prompt", async () => {
      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts/unknown-id`)
      );
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /v1/projects/:projectId/prompts/:promptId", () => {
    it("updates a prompt", async () => {
      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts/${promptId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: "Updated description" }),
        })
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.description).toBe("Updated description");
    });
  });

  let versionId: string;

  describe("POST /v1/projects/:projectId/prompts/:promptId/versions", () => {
    it("creates a version", async () => {
      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts/${promptId}/versions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [
              { role: "system", content: "You are helpful." },
              { role: "user", content: "Hi" },
            ],
          }),
        })
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.promptId).toBe(promptId);
      expect(body.projectId).toBe(projectId);
      expect(body.version).toBe(1);
      expect(Array.isArray(body.messages)).toBe(true);
      versionId = body.id as string;
    });

    it("creates incrementing versions", async () => {
      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts/${promptId}/versions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "v2" }],
          }),
        })
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { version: number };
      expect(body.version).toBe(2);
    });

    it("rejects invalid version input", async () => {
      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts/${promptId}/versions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: "not-an-array" }),
        })
      );
      expect(res.status).toBe(400);
    });
  });

  describe("GET /v1/projects/:projectId/prompts/:promptId/versions", () => {
    it("lists versions", async () => {
      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts/${promptId}/versions`)
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[]; total: number };
      expect(body.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe("GET /v1/projects/:projectId/prompts/:promptId/versions/:versionId", () => {
    it("gets a version by id", async () => {
      const res = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/prompts/${promptId}/versions/${versionId}`
        )
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.id).toBe(versionId);
    });

    it("returns 404 for unknown version", async () => {
      const res = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/prompts/${promptId}/versions/unknown-id`
        )
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST .../versions/:versionId/publish", () => {
    it("publishes a version", async () => {
      const res = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/prompts/${promptId}/versions/${versionId}/publish`,
          { method: "POST" }
        )
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.publishedVersionId).toBe(versionId);
    });

    it("returns 404 for unknown version", async () => {
      const res = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/prompts/${promptId}/versions/unknown-id/publish`,
          { method: "POST" }
        )
      );
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /v1/projects/:projectId/prompts/:promptId", () => {
    it("deletes a prompt", async () => {
      const createRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Temp Prompt", slug: "temp-prompt" }),
        })
      );
      const created = (await createRes.json()) as Record<string, unknown>;
      const tempPromptId = created.id as string;

      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts/${tempPromptId}`, {
          method: "DELETE",
        })
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { deleted: boolean };
      expect(body.deleted).toBe(true);
    });

    it("returns 404 for deleting unknown prompt", async () => {
      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts/unknown-id`, {
          method: "DELETE",
        })
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST .../prompts/:promptId/execute", () => {
    it("returns 400 when no model is configured or provided", async () => {
      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts/${promptId}/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("PROMPT_MODEL_REQUIRED");
    });

    it("renders inputs and executes the published prompt", async () => {
      const createRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Executable", slug: "executable-prompt" }),
        })
      );
      const created = (await createRes.json()) as Record<string, unknown>;
      const executablePromptId = created.id as string;

      const versionRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/prompts/${executablePromptId}/versions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "test/model",
              messages: [{ role: "user", content: "Hello {name}" }],
            }),
          }
        )
      );
      const version = (await versionRes.json()) as Record<string, unknown>;
      await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/prompts/${executablePromptId}/versions/${version.id}/publish`,
          { method: "POST" }
        )
      );

      completeRequests = [];
      const res = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/prompts/${executablePromptId}/execute`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ inputs: { name: "Ada" } }),
          }
        )
      );
      expect(res.status).toBe(200);
      expect(completeRequests).toHaveLength(1);
      expect(completeRequests[0]?.model).toBe("test/model");
      expect(completeRequests[0]?.messages?.[0]?.content).toBe("Hello Ada");
    });

    it("returns 400 when prompt has no published version", async () => {
      // Create a new prompt without a published version
      const createRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Unpublished", slug: "unpublished-prompt" }),
        })
      );
      const unprompt = (await createRes.json()) as Record<string, unknown>;
      const unpromptId = unprompt.id as string;

      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts/${unpromptId}/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("PROMPT_NOT_PUBLISHED");
    });

    it("returns 404 for unknown prompt", async () => {
      const res = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts/nonexistent/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
      );
      expect(res.status).toBe(404);
    });
  });

  describe("Conversation and message routes", () => {
    let conversationId: string;
    let messageId: string;

    it("creates, lists, gets, and updates conversations", async () => {
      const createRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/conversations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            externalUserId: "user-1",
            title: "Support chat",
            metadata: { channel: "web" },
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as Record<string, unknown>;
      conversationId = created.id as string;
      expect(created.projectId).toBe(projectId);
      expect(created.status).toBe("active");

      const listRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/conversations?externalUserId=user-1`
        )
      );
      expect(listRes.status).toBe(200);
      const listed = (await listRes.json()) as { items: Array<Record<string, unknown>> };
      expect(listed.items.some((item) => item.id === conversationId)).toBe(true);

      const getRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/conversations/${conversationId}`)
      );
      expect(getRes.status).toBe(200);

      const patchRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/conversations/${conversationId}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Updated chat", status: "archived" }),
          }
        )
      );
      expect(patchRes.status).toBe(200);
      const updated = (await patchRes.json()) as Record<string, unknown>;
      expect(updated.title).toBe("Updated chat");
      expect(updated.status).toBe("archived");
    });

    it("appends, lists, and updates conversation messages", async () => {
      const appendRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/conversations/${conversationId}/messages`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ role: "user", content: "hello", status: "pending" }),
          }
        )
      );
      expect(appendRes.status).toBe(201);
      const appended = (await appendRes.json()) as Record<string, unknown>;
      messageId = appended.id as string;
      expect(appended.conversationId).toBe(conversationId);

      const listRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/conversations/${conversationId}/messages`
        )
      );
      expect(listRes.status).toBe(200);
      const listed = (await listRes.json()) as { items: Array<Record<string, unknown>> };
      expect(listed.items.some((item) => item.id === messageId)).toBe(true);

      const patchRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/messages/${messageId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "hello world", status: "complete", tokenCount: 2 }),
        })
      );
      expect(patchRes.status).toBe(200);
      const updated = (await patchRes.json()) as Record<string, unknown>;
      expect(updated.content).toBe("hello world");
      expect(updated.status).toBe("complete");
    });

    it("sends a managed conversation message and records the run", async () => {
      completeRequests = [];
      const promptRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Support Agent", slug: "support-agent" }),
        })
      );
      expect(promptRes.status).toBe(201);
      const prompt = (await promptRes.json()) as Record<string, unknown>;

      const versionRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/prompts/${prompt.id as string}/versions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messages: [{ role: "system", content: "You support {product}." }],
              model: "test/model",
            }),
          }
        )
      );
      expect(versionRes.status).toBe(201);
      const version = (await versionRes.json()) as Record<string, unknown>;

      const publishRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/prompts/${prompt.id as string}/versions/${version.id as string}/publish`,
          { method: "POST" }
        )
      );
      expect(publishRes.status).toBe(200);

      const conversationRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/conversations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ externalUserId: "managed-user", title: "Managed chat" }),
        })
      );
      expect(conversationRes.status).toBe(201);
      const conversation = (await conversationRes.json()) as Record<string, unknown>;

      const sendRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/conversations/${conversation.id as string}/messages/send`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              content: "My invoice is wrong",
              prompt: "support-agent",
              promptInputs: { product: "Weysabi" },
              externalUserId: "managed-user",
              metadata: { ticketId: "ticket-1" },
            }),
          }
        )
      );
      expect(sendRes.status).toBe(201);
      const sent = (await sendRes.json()) as {
        userMessage: Record<string, unknown>;
        assistantMessage: Record<string, unknown>;
        run: Record<string, unknown>;
      };
      expect(sent.userMessage.content).toBe("My invoice is wrong");
      expect(sent.assistantMessage.content).toBe("ok");
      expect(sent.run.status).toBe("success");
      expect(sent.run.promptId).toBe(prompt.id);
      expect(sent.run.promptVersionId).toBe(version.id);
      expect(sent.run.totalTokens).toBe(5);

      expect(completeRequests).toHaveLength(1);
      expect(completeRequests[0]!.messages?.[0]?.content).toBe("You support Weysabi.");
      expect(completeRequests[0]!.messages?.at(-1)?.content).toBe("My invoice is wrong");

      const messagesRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/conversations/${conversation.id as string}/messages`
        )
      );
      const messages = (await messagesRes.json()) as { items: Array<Record<string, unknown>> };
      expect(messages.items.map((item) => item.role)).toEqual(["user", "assistant"]);

      const runsRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/runs?conversationId=${conversation.id as string}`
        )
      );
      const runs = (await runsRes.json()) as { items: Array<Record<string, unknown>> };
      expect(runs.items).toHaveLength(1);
      expect(runs.items[0]?.status).toBe("success");
    });

    it("accepts promptVersionId when sending a managed conversation message", async () => {
      completeRequests = [];
      const promptRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/prompts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: `Version Alias ${Date.now()}`,
            slug: `version-alias-${Date.now()}`,
          }),
        })
      );
      expect(promptRes.status).toBe(201);
      const prompt = (await promptRes.json()) as Record<string, unknown>;

      const versionRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/prompts/${prompt.id as string}/versions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messages: [{ role: "system", content: "Version alias prompt." }],
              model: "test/model",
            }),
          }
        )
      );
      expect(versionRes.status).toBe(201);
      const version = (await versionRes.json()) as Record<string, unknown>;

      const conversationRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/conversations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Prompt version alias chat" }),
        })
      );
      expect(conversationRes.status).toBe(201);
      const conversation = (await conversationRes.json()) as Record<string, unknown>;

      const sendRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/conversations/${conversation.id as string}/messages/send`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              content: "Use a concrete version",
              promptVersionId: version.id,
            }),
          }
        )
      );
      expect(sendRes.status).toBe(201);
      const sent = (await sendRes.json()) as { run: Record<string, unknown> };
      expect(sent.run.promptVersionId).toBe(version.id);
      expect(completeRequests[0]?.messages?.[0]?.content).toBe("Version alias prompt.");
    });

    it("records a failed run while preserving the user message", async () => {
      const conversationRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/conversations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ externalUserId: "failure-user", title: "Failure chat" }),
        })
      );
      expect(conversationRes.status).toBe(201);
      const conversation = (await conversationRes.json()) as Record<string, unknown>;

      const sendRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/conversations/${conversation.id as string}/messages/send`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              content: "provider fails",
              model: "test/model",
            }),
          }
        )
      );
      expect(sendRes.status).toBe(500);

      const messagesRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/conversations/${conversation.id as string}/messages`
        )
      );
      const messages = (await messagesRes.json()) as { items: Array<Record<string, unknown>> };
      expect(messages.items).toHaveLength(1);
      expect(messages.items[0]?.role).toBe("user");
      expect(messages.items[0]?.content).toBe("provider fails");

      const runsRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/runs?conversationId=${conversation.id as string}`
        )
      );
      const runs = (await runsRes.json()) as { items: Array<Record<string, unknown>> };
      expect(runs.items).toHaveLength(1);
      expect(runs.items[0]?.status).toBe("failed");
      expect(runs.items[0]?.errorCode).toBe("RUN_FAILED");
    });

    it("streams a managed conversation message and completes the run", async () => {
      const conversationRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/conversations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Stream chat" }),
        })
      );
      expect(conversationRes.status).toBe(201);
      const conversation = (await conversationRes.json()) as Record<string, unknown>;

      const streamRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/conversations/${conversation.id as string}/messages/stream`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: "stream hello", model: "test/model" }),
          }
        )
      );
      expect(streamRes.status).toBe(200);
      expect(streamRes.headers.get("content-type")).toContain("text/event-stream");
      const text = await streamRes.text();
      expect(text).toContain('"type":"content.delta","content":"he"');
      expect(text).toContain('"type":"message.completed"');
      expect(text).toContain("data: [DONE]");

      const messagesRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/conversations/${conversation.id as string}/messages`
        )
      );
      const messages = (await messagesRes.json()) as { items: Array<Record<string, unknown>> };
      expect(messages.items.map((item) => item.content)).toEqual(["stream hello", "hello"]);
      expect(messages.items[1]?.status).toBe("complete");

      const runsRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/runs?conversationId=${conversation.id as string}`
        )
      );
      const runs = (await runsRes.json()) as { items: Array<Record<string, unknown>> };
      expect(runs.items[0]?.status).toBe("success");
      expect(runs.items[0]?.totalTokens).toBe(6);
    });

    it("records interrupted streamed assistant output", async () => {
      const conversationRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/conversations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Interrupted stream chat" }),
        })
      );
      expect(conversationRes.status).toBe(201);
      const conversation = (await conversationRes.json()) as Record<string, unknown>;

      const streamRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/conversations/${conversation.id as string}/messages/stream`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: "stream interrupts", model: "test/model" }),
          }
        )
      );
      expect(streamRes.status).toBe(200);
      const text = await streamRes.text();
      expect(text).toContain('"type":"message.interrupted"');
      expect(text).toContain('"code":"RUN_INTERRUPTED"');

      const messagesRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/conversations/${conversation.id as string}/messages`
        )
      );
      const messages = (await messagesRes.json()) as { items: Array<Record<string, unknown>> };
      expect(messages.items.map((item) => item.content)).toEqual(["stream interrupts", "he"]);
      expect(messages.items[1]?.status).toBe("interrupted");

      const runsRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/runs?conversationId=${conversation.id as string}`
        )
      );
      const runs = (await runsRes.json()) as { items: Array<Record<string, unknown>> };
      expect(runs.items[0]?.status).toBe("interrupted");
      expect(runs.items[0]?.errorCode).toBe("RUN_INTERRUPTED");
    });
  });

  describe("Run routes", () => {
    let runId: string;

    it("creates, lists, gets, updates, and summarizes runs", async () => {
      const createRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestedModel: "test/model",
            status: "pending",
            metadata: { source: "test" },
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as Record<string, unknown>;
      runId = created.id as string;
      expect(created.projectId).toBe(projectId);

      const listRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/runs?status=pending`)
      );
      expect(listRes.status).toBe(200);
      const listed = (await listRes.json()) as { items: Array<Record<string, unknown>> };
      expect(listed.items.some((item) => item.id === runId)).toBe(true);

      const patchRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/runs/${runId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "success", totalTokens: 12, latencyMs: 25 }),
        })
      );
      expect(patchRes.status).toBe(200);
      const updated = (await patchRes.json()) as Record<string, unknown>;
      expect(updated.status).toBe("success");
      expect(updated.totalTokens).toBe(12);

      const getRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/runs/${runId}`)
      );
      expect(getRes.status).toBe(200);

      const statsRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/runs/stats`)
      );
      expect(statsRes.status).toBe(200);
      const stats = (await statsRes.json()) as Record<string, unknown>;
      expect(Number(stats.totalRuns)).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Document routes", () => {
    let documentId: string;

    it("creates, lists, gets, updates status, and deletes documents", async () => {
      const createRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/documents`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "readme.md",
            sourceType: "file",
            contentHash: `hash-${Date.now()}`,
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as Record<string, unknown>;
      documentId = created.id as string;
      expect(created.status).toBe("pending");

      const listRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/documents?sourceType=file`)
      );
      expect(listRes.status).toBe(200);
      const listed = (await listRes.json()) as { items: Array<Record<string, unknown>> };
      expect(listed.items.some((item) => item.id === documentId)).toBe(true);

      const getRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/documents/${documentId}`)
      );
      expect(getRes.status).toBe(200);

      const statusRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/documents/${documentId}/status`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "ready" }),
        })
      );
      expect(statusRes.status).toBe(200);
      const updated = (await statusRes.json()) as Record<string, unknown>;
      expect(updated.status).toBe("ready");

      const deleteRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/documents/${documentId}`, {
          method: "DELETE",
        })
      );
      expect(deleteRes.status).toBe(200);
    });
  });

  describe("Project API key routes", () => {
    let apiKeyId: string;

    it("creates keys and only returns the secret once", async () => {
      const createRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/api-keys`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Development key",
            scopes: ["chat:write", "conversations:read"],
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as Record<string, unknown>;
      apiKeyId = created.id as string;
      expect(typeof created.secret).toBe("string");
      expect(String(created.secret)).toStartWith("sabi_");

      const getRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/api-keys/${apiKeyId}`)
      );
      expect(getRes.status).toBe(200);
      const fetched = (await getRes.json()) as Record<string, unknown>;
      expect("secret" in fetched).toBe(false);

      const listRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/api-keys`)
      );
      expect(listRes.status).toBe(200);
      const listed = (await listRes.json()) as { items: Array<Record<string, unknown>> };
      expect(listed.items.some((item) => item.id === apiKeyId)).toBe(true);
      expect(listed.items.some((item) => "secret" in item)).toBe(false);
    });

    it("updates and deletes API keys", async () => {
      const patchRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/api-keys/${apiKeyId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Renamed key", scopes: ["project:admin"] }),
        })
      );
      expect(patchRes.status).toBe(200);
      const updated = (await patchRes.json()) as Record<string, unknown>;
      expect(updated.name).toBe("Renamed key");

      const deleteRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/api-keys/${apiKeyId}`, {
          method: "DELETE",
        })
      );
      expect(deleteRes.status).toBe(200);
    });
  });

  describe("Project API key authentication", () => {
    async function createKey(scopes: string[]): Promise<string> {
      const createRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/api-keys`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: `Scoped key ${Date.now()}`, scopes }),
        })
      );
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as Record<string, unknown>;
      return created.secret as string;
    }

    it("allows a scoped project key to send managed conversation messages", async () => {
      const secret = await createKey(["chat:write", "conversations:read"]);
      const conversationRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/conversations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Project key chat" }),
        })
      );
      expect(conversationRes.status).toBe(201);
      const conversation = (await conversationRes.json()) as Record<string, unknown>;

      completeRequests = [];
      const sendRes = await router.fetch(
        projectRequest(
          `http://localhost/v1/projects/${projectId}/conversations/${conversation.id as string}/messages/send`,
          secret,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: "from project key", model: "test/model" }),
          }
        )
      );
      expect(sendRes.status).toBe(201);
      const sent = (await sendRes.json()) as { assistantMessage: Record<string, unknown> };
      expect(sent.assistantMessage.content).toBe("ok");
      expect(completeRequests).toHaveLength(1);
    });

    it("rejects project keys outside their project or scope", async () => {
      const secret = await createKey(["chat:write"]);
      const otherProjectRes = await router.fetch(
        controlRequest("http://localhost/v1/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Other Project", slug: `other-project-${Date.now()}` }),
        })
      );
      expect(otherProjectRes.status).toBe(201);
      const otherProject = (await otherProjectRes.json()) as Record<string, unknown>;

      const crossProjectRes = await router.fetch(
        projectRequest(
          `http://localhost/v1/projects/${otherProject.id as string}/conversations`,
          secret
        )
      );
      expect(crossProjectRes.status).toBe(403);

      const promptRes = await router.fetch(
        projectRequest(`http://localhost/v1/projects/${projectId}/prompts`, secret, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Blocked Prompt", slug: `blocked-${Date.now()}` }),
        })
      );
      expect(promptRes.status).toBe(403);
    });

    it("idempotently retries managed message submission", async () => {
      const secret = await createKey(["chat:write", "conversations:read"]);
      const conversationRes = await router.fetch(
        controlRequest(`http://localhost/v1/projects/${projectId}/conversations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Idempotent project key chat" }),
        })
      );
      expect(conversationRes.status).toBe(201);
      const conversation = (await conversationRes.json()) as Record<string, unknown>;
      const url = `http://localhost/v1/projects/${projectId}/conversations/${conversation.id as string}/messages/send`;
      const body = { content: "retry this once", model: "test/model" };

      completeRequests = [];
      const firstRes = await router.fetch(
        projectRequest(url, secret, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "managed-message-retry",
          },
          body: JSON.stringify(body),
        })
      );
      expect(firstRes.status).toBe(201);
      const first = (await firstRes.json()) as { run: Record<string, unknown> };

      const secondRes = await router.fetch(
        projectRequest(url, secret, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "managed-message-retry",
          },
          body: JSON.stringify(body),
        })
      );
      expect(secondRes.status).toBe(200);
      const second = (await secondRes.json()) as { run: Record<string, unknown> };
      expect(second.run.id).toBe(first.run.id);
      expect(completeRequests).toHaveLength(1);

      const messagesRes = await router.fetch(
        controlRequest(
          `http://localhost/v1/projects/${projectId}/conversations/${conversation.id as string}/messages`
        )
      );
      const messages = (await messagesRes.json()) as { items: Array<Record<string, unknown>> };
      expect(messages.items).toHaveLength(2);

      const conflictRes = await router.fetch(
        projectRequest(url, secret, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "managed-message-retry",
          },
          body: JSON.stringify({ ...body, content: "different body" }),
        })
      );
      expect(conflictRes.status).toBe(409);
    });
  });
});
