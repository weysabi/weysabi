import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createWeysabi } from "@weysabi/sabi";
import { createRouter } from "./routes";

describe("Idempotency", () => {
  let originalFetch: typeof globalThis.fetch;
  let reqCount: number;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns cached response for duplicate idempotency key", async () => {
    reqCount = 0;
    globalThis.fetch = (() => {
      reqCount++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: `response ${reqCount}`, role: "assistant" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            model: "llama-4-scout",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    }) as unknown as typeof globalThis.fetch;

    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const router = await createRouter(sabi);

    const body = JSON.stringify({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Hi" }],
    });

    const req1 = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "test-idem-1",
      },
      body,
    });
    const res1 = await router.fetch(req1);
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as Record<string, unknown>;
    const choices1 = body1.choices as Array<Record<string, unknown>>;

    const req2 = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "test-idem-1",
      },
      body,
    });
    const res2 = await router.fetch(req2);
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as Record<string, unknown>;
    const choices2 = body2.choices as Array<Record<string, unknown>>;

    expect(choices2[0]!.message).toEqual(choices1[0]!.message);
    expect(reqCount).toBe(1); // Only called provider once
  });

  it("rejects reuse of an idempotency key with a different request", async () => {
    reqCount = 0;
    globalThis.fetch = (() => {
      reqCount++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "response", role: "assistant" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    }) as unknown as typeof globalThis.fetch;

    const router = await createRouter(createWeysabi({ groq: { apiKey: "test-key" } }));
    const request = (content: string) =>
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "same-key",
        },
        body: JSON.stringify({
          model: "groq/llama-4-scout",
          messages: [{ role: "user", content }],
        }),
      });

    expect((await router.fetch(request("first"))).status).toBe(200);
    const conflict = await router.fetch(request("different"));
    expect(conflict.status).toBe(409);
    const body = (await conflict.json()) as { error: { code: string } };
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(reqCount).toBe(1);
  });

  it("uses injected stores without disposing caller-owned resources", async () => {
    let rateLimitIncrements = 0;
    let idempotencyGets = 0;
    let idempotencySets = 0;
    let disposeCalls = 0;
    const values = new Map<string, unknown>();
    const rateLimitStore = {
      async increment() {
        rateLimitIncrements++;
        return { count: 1, reset: Date.now() + 60_000 };
      },
      async reset() {},
      dispose() {
        disposeCalls++;
      },
    };
    const idempotencyStore = {
      async get(key: string) {
        idempotencyGets++;
        return values.get(key) ?? null;
      },
      async set(key: string, value: unknown) {
        idempotencySets++;
        values.set(key, value);
      },
      async delete(key: string) {
        values.delete(key);
      },
      dispose() {
        disposeCalls++;
      },
    };
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok", role: "assistant" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )) as unknown as typeof globalThis.fetch;

    const router = await createRouter(createWeysabi({ groq: { apiKey: "test-key" } }), {
      rateLimitStore,
      idempotencyStore,
    });
    const response = await router.fetch(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "persistent-key",
        },
        body: JSON.stringify({
          model: "groq/llama-4-scout",
          messages: [{ role: "user", content: "Hi" }],
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(rateLimitIncrements).toBe(1);
    expect(idempotencyGets).toBe(1);
    expect(idempotencySets).toBe(1);
    router.close();
    expect(disposeCalls).toBe(0);
  });

  it("does not cache streaming responses", async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`
                )
              );
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    choices: [{ delta: {}, finish_reason: "stop" }],
                  })}\n\n`
                )
              );
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } }
        )
      )) as unknown as typeof globalThis.fetch;

    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const router = await createRouter(sabi);

    const body = JSON.stringify({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Hi" }],
      stream: true,
    });

    const req1 = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "stream-test",
      },
      body,
    });
    const res1 = await router.fetch(req1);
    expect(res1.status).toBe(200);
    const text1 = await res1.text();

    const req2 = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "stream-test",
      },
      body,
    });
    const res2 = await router.fetch(req2);
    expect(res2.status).toBe(200);
    const text2 = await res2.text();

    // Streaming responses are not cached, but both should work
    expect(text1).toInclude("data: ");
    expect(text2).toInclude("data: ");
  });
});
