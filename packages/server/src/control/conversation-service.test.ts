import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWeysabi } from "@weysabi/sabi";
import { createSqliteControlPlaneStore } from "./sqlite-store";
import { createConversationService } from "./conversation-service";
import type { ControlPlaneStore } from "./store";

function okResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: { message: `Error ${status}` } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function seedStore(store: ControlPlaneStore): Promise<{ projectId: string }> {
  const project = await store.projects.create({
    name: "test",
    slug: "test",
  });
  return { projectId: project.id };
}

function createFetchMock(
  failContent: string
): (url: string | URL | Request, init?: RequestInit) => Promise<Response> {
  let callIndex = 0;
  return async (url: string | URL | Request, init?: RequestInit) => {
    callIndex++;
    const bodyStr =
      typeof init?.body === "string"
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : "{}";
    const body = JSON.parse(bodyStr) as {
      model?: string;
      messages?: Array<{ content: string }>;
    };
    const userContent = body.messages?.at(-1)?.content ?? "";

    if (userContent === failContent && callIndex === 1) {
      return errorResponse(503);
    }
    return okResponse({
      choices: [{ message: { content: "ok", role: "assistant" } }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      model: body.model ?? "",
    });
  };
}

describe("ConversationService", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("sendMessage — fallback-attempt recording", () => {
    it("records the successful model when no fallback occurs", async () => {
      globalThis.fetch = (async (
        _url: string | URL | Request,
        _init?: RequestInit
      ): Promise<Response> =>
        okResponse({
          choices: [{ message: { content: "Hello", role: "assistant" } }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          model: "openai/gpt-4o-mini",
        })) as unknown as typeof globalThis.fetch;

      const store = await createSqliteControlPlaneStore(":memory:");
      try {
        const { projectId } = await seedStore(store);
        const sabi = createWeysabi({ openai: { apiKey: "key" } });
        const cs = createConversationService(sabi, store);
        const conv = await store.conversations.createConversation({
          projectId,
          externalUserId: "user-1",
        });

        const result = await cs.sendMessage({
          projectId,
          conversationId: conv.id,
          content: "hi",
          model: "openai/gpt-4o-mini",
        });

        expect(result.run.fallbackAttempts).toHaveLength(1);
        expect(result.run.fallbackAttempts[0]!.model).toBe("openai/gpt-4o-mini");
        expect(result.run.fallbackAttempts[0]!.provider).toBe("openai");
        expect(result.run.fallbackAttempts[0]!.latencyMs).toBeGreaterThanOrEqual(0);
        expect(result.run.fallbackAttempts[0]!.error).toBeUndefined();
      } finally {
        await store.close();
      }
    });

    it("records each fallback attempt when primary model fails", async () => {
      globalThis.fetch = createFetchMock("fail-first") as unknown as typeof globalThis.fetch;

      const store = await createSqliteControlPlaneStore(":memory:");
      try {
        const { projectId } = await seedStore(store);
        const sabi = createWeysabi(
          { groq: { apiKey: "gk" }, openai: { apiKey: "ok" } },
          { retry: { maxRetries: 0 } }
        );
        const cs = createConversationService(sabi, store);
        const conv = await store.conversations.createConversation({
          projectId,
          externalUserId: "user-1",
        });

        const result = await cs.sendMessage({
          projectId,
          conversationId: conv.id,
          content: "fail-first",
          model: ["groq/llama-3.1-8b-instant", "openai/gpt-4o-mini"],
        });

        expect(result.run.fallbackAttempts).toHaveLength(2);
        expect(result.run.fallbackAttempts[0]!.model).toBe("groq/llama-3.1-8b-instant");
        expect(result.run.fallbackAttempts[0]!.error).toContain("503");
        expect(result.run.fallbackAttempts[0]!.latencyMs).toBeGreaterThanOrEqual(0);
        expect(result.run.fallbackAttempts[1]!.model).toBe("openai/gpt-4o-mini");
        expect(result.run.fallbackAttempts[1]!.provider).toBe("openai");
        expect(result.run.fallbackAttempts[1]!.latencyMs).toBeGreaterThanOrEqual(0);
        expect(result.run.fallbackAttempts[1]!.error).toBeUndefined();
      } finally {
        await store.close();
      }
    });

    it("records all fallback attempts when all models fail", async () => {
      globalThis.fetch = (async (): Promise<Response> =>
        errorResponse(500)) as unknown as typeof globalThis.fetch;

      const store = await createSqliteControlPlaneStore(":memory:");
      try {
        const { projectId } = await seedStore(store);
        const sabi = createWeysabi(
          { groq: { apiKey: "gk" }, nvidia: { apiKey: "nk" } },
          { retry: { maxRetries: 0 } }
        );
        const cs = createConversationService(sabi, store);
        const conv = await store.conversations.createConversation({
          projectId,
          externalUserId: "user-1",
        });

        await expect(
          cs.sendMessage({
            projectId,
            conversationId: conv.id,
            content: "fail-all",
            model: ["groq/llama-3.1-8b-instant", "nvidia/llama-3.1-8b-instruct"],
          })
        ).rejects.toThrow();

        const runs = await store.runs.list(projectId);
        expect(runs.items).toHaveLength(1);
        expect(runs.items[0]!.fallbackAttempts).toHaveLength(2);
        expect(runs.items[0]!.fallbackAttempts[0]!.model).toBe("groq/llama-3.1-8b-instant");
        expect(runs.items[0]!.fallbackAttempts[0]!.error).toBeTruthy();
        expect(runs.items[0]!.fallbackAttempts[1]!.model).toBe("nvidia/llama-3.1-8b-instruct");
        expect(runs.items[0]!.fallbackAttempts[1]!.error).toBeTruthy();
        expect(runs.items[0]!.status).toBe("failed");
      } finally {
        await store.close();
      }
    });
  });

  describe("streamMessage — fallback-attempt recording", () => {
    it("records all fallback attempts when stream failover occurs", async () => {
      let callCount = 0;
      globalThis.fetch = (async (): Promise<Response> => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Stream connection failed");
        }
        return new Response(
          "data: " +
            JSON.stringify({ choices: [{ delta: { content: "ok", role: "assistant" } }] }) +
            "\n\ndata: [DONE]\n\n",
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }
        );
      }) as unknown as typeof globalThis.fetch;

      const store = await createSqliteControlPlaneStore(":memory:");
      try {
        const { projectId } = await seedStore(store);
        const sabi = createWeysabi(
          { groq: { apiKey: "gk" }, openai: { apiKey: "ok" } },
          { retry: { maxRetries: 0 } }
        );
        const cs = createConversationService(sabi, store);
        const conv = await store.conversations.createConversation({
          projectId,
          externalUserId: "user-1",
        });

        const events: unknown[] = [];
        for await (const event of cs.streamMessage({
          projectId,
          conversationId: conv.id,
          content: "stream-fallback",
          model: ["groq/llama-3.1-8b-instant", "openai/gpt-4o-mini"],
        })) {
          events.push(event);
        }

        const runs = await store.runs.list(projectId);
        expect(runs.items).toHaveLength(1);
        expect(runs.items[0]!.fallbackAttempts).toHaveLength(2);
        expect(runs.items[0]!.fallbackAttempts[0]!.model).toBe("groq/llama-3.1-8b-instant");
        expect(runs.items[0]!.fallbackAttempts[0]!.error).toBeTruthy();
        expect(runs.items[0]!.fallbackAttempts[1]!.model).toBe("openai/gpt-4o-mini");
        expect(runs.items[0]!.status).toBe("success");
      } finally {
        await store.close();
      }
    });
  });
});
