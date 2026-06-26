import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createWeysabi } from "@weysabi/sabi";
import type { StreamRequest, Weysabi } from "@weysabi/sabi";
import { createRouter } from "./routes";

describe("Server integration", () => {
  let router: { fetch: (req: Request) => Response | Promise<Response> };
  let originalFetch: typeof globalThis.fetch;

  function mockJsonResponse(): void {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Hello from mock", role: "assistant" } }],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            model: "llama-4-scout",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )) as unknown as typeof globalThis.fetch;
  }

  function mockStreamResponse(): void {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
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
    });
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      )) as unknown as typeof globalThis.fetch;
  }

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    mockJsonResponse();
    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    router = await createRouter(sabi);
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("POST /v1/chat/completions returns valid OpenAI-compatible response", async () => {
    mockJsonResponse();
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const choices = body.choices as Array<Record<string, unknown>>;
    const usage = body.usage as Record<string, unknown>;
    expect(body.object).toBe("chat.completion");
    expect(choices).toHaveLength(1);
    expect((choices[0]!.message as Record<string, unknown>).content).toBe("Hello from mock");
    expect((choices[0]!.message as Record<string, unknown>).role).toBe("assistant");
    expect(usage.prompt_tokens).toBe(5);
    expect(body.model).toBe("groq/llama-4-scout");
  });

  it("POST /v1/chat/completions with stream=true returns SSE", async () => {
    mockStreamResponse();
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      }),
    });

    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const text = await res.text();
    expect(text).toInclude("data: ");
    expect(text).toInclude("[DONE]");
    const lines = text.split("\n").filter(Boolean);
    const dataLine = lines.find((l) => l.startsWith("data: ") && l !== "data: [DONE]");
    expect(dataLine).toBeTruthy();
    const parsed = JSON.parse(dataLine!.slice(6));
    expect(parsed.object).toBe("chat.completion.chunk");
  });

  it("GET /v1/models returns sabi-proxy when no providers configured", async () => {
    const req = new Request("http://localhost/v1/models");
    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const data = body.data as Array<Record<string, unknown>>;
    expect(body.object).toBe("list");
    expect(data).toHaveLength(1);
    expect(data[0]!.id).toBe("sabi-proxy");
  });

  it("GET /v1/models returns provider models when providers specified", async () => {
    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const providerRouter = await createRouter(sabi, {
      providers: ["groq", "openai"],
    });
    const req = new Request("http://localhost/v1/models");
    const res = await providerRouter.fetch(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const data = body.data as Array<Record<string, unknown>>;
    expect(body.object).toBe("list");
    expect(data).toHaveLength(2);
    expect(data[0]!.id).toBe("groq/*");
    expect(data[0]!.owned_by).toBe("groq");
    expect(data[1]!.id).toBe("openai/*");
    expect(data[1]!.owned_by).toBe("openai");
  });

  it("GET /health returns ok", async () => {
    const req = new Request("http://localhost/health");
    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.timestamp as number).toBeGreaterThan(0);
  });

  it("returns 500 on provider error", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("Internal error", { status: 500 })
      )) as unknown as typeof globalThis.fetch;

    const errSabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const errorRouter = await createRouter(errSabi);

    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    const res = await errorRouter.fetch(req);
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    const error = body.error as Record<string, unknown>;
    expect(error.message).toInclude("All models failed");
    expect(error.code).toBe("ALL_MODELS_FAILED");
  });

  it("returns 400 for malformed JSON", async () => {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });

    const res = await router.fetch(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_JSON");
  });

  it("returns 400 for schema validation errors", async () => {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "groq/llama-4-scout" }),
    });

    const res = await router.fetch(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: unknown[] } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it("returns 413 when the request body exceeds the configured limit", async () => {
    const limited = await createRouter(createWeysabi({ groq: { apiKey: "test-key" } }), {
      maxBodyBytes: 64,
    });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "x".repeat(100) }],
      }),
    });

    const res = await limited.fetch(req);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("passes the client abort signal into Weysabi streams", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fakeSabi = {
      stream(request: StreamRequest) {
        capturedSignal = request.signal;
        return (async function* () {
          yield { content: "", done: true };
        })();
      },
    } as unknown as Weysabi;
    const signalRouter = await createRouter(fakeSabi);
    const controller = new AbortController();
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      }),
    });

    const res = await signalRouter.fetch(req);
    expect(capturedSignal?.aborted).toBe(false);
    controller.abort();
    expect(capturedSignal?.aborted).toBe(true);
    await res.body?.cancel();
  });
});
