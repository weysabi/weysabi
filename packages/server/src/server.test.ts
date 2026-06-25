import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { translateRequest, translateResponse, translateStreamChunk } from "./translate";
import { createRouter } from "./routes";
import { createWeysabi } from "@weysabi/sabi";
import type { StreamRequest, Weysabi } from "@weysabi/sabi";
import { resolveApiKeys, parseApiKeys, resolveClientIp } from "./middleware";
import { buildModelAliases, resolveAlias, getAliasesList } from "./aliases";
import { fingerprintApiKey, fingerprintRequestApiKey, InMemoryTokenQuotaStore } from "./quota";
import { InMemoryUsageLedger } from "./ledger";

describe("translateRequest", () => {
  it("converts OpenAI-style request to Weysabi CompleteRequest", () => {
    const result = translateRequest({
      model: "groq/llama-4-scout",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ],
      temperature: 0.7,
      max_tokens: 100,
      top_p: 0.9,
      stop: ["END"],
    });

    expect(result.model).toBe("groq/llama-4-scout");
    expect(result.messages).toHaveLength(2);
    expect(result.temperature).toBe(0.7);
    expect(result.maxTokens).toBe(100);
    expect(result.topP).toBe(0.9);
    expect(result.stop).toEqual(["END"]);
  });

  it("handles minimal request", () => {
    const result = translateRequest({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.model).toBe("groq/llama-4-scout");
    expect(result.messages).toHaveLength(1);
    expect(result.temperature).toBeUndefined();
  });

  it("handles sabi-specific fields", () => {
    const result = translateRequest({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Hi" }],
      sabi_fallbacks: ["openai/gpt-4o-mini"],
      sabi_rag: true,
    });

    expect(result.fallbacks).toEqual(["openai/gpt-4o-mini"]);
    expect(result.rag).toBeTrue();
  });

  it("supports OpenAI token, response format, and stream usage fields", () => {
    const result = translateRequest({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Hi" }],
      max_completion_tokens: 250,
      response_format: { type: "json_object" },
      stream_options: { include_usage: true },
      n: 1,
    });

    expect(result.maxTokens).toBe(250);
    expect(result.responseFormat).toEqual({ type: "json_object" });
    expect(result.includeUsage).toBeTrue();
  });

  it("rejects unsupported OpenAI request behavior explicitly", () => {
    const base = {
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Hi" }],
    };

    expect(() => translateRequest({ ...base, n: 2 })).toThrow("Only n=1");
    expect(() => translateRequest({ ...base, tools: [] })).toThrow("tool calling");
    expect(() =>
      translateRequest({
        ...base,
        max_tokens: 100,
        max_completion_tokens: 200,
      })
    ).toThrow("must match");
  });

  it("rejects missing messages", () => {
    expect(() =>
      translateRequest({
        model: "groq/llama-4-scout",
      })
    ).toThrow();
  });
});

describe("translateResponse", () => {
  it("converts Weysabi CompleteResponse to OpenAI format", () => {
    const result = translateResponse(
      {
        content: "Hello!",
        model: "groq/llama-4-scout",
        provider: "groq",
        latencyMs: 100,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
      "groq/llama-4-scout"
    );

    expect(result.object).toBe("chat.completion");
    expect(result.choices).toHaveLength(1);
    expect((result.choices as Array<Record<string, unknown>>)[0]!.message).toEqual({
      role: "assistant",
      content: "Hello!",
    });
    expect(result.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    });
  });

  it("handles missing usage", () => {
    const result = translateResponse(
      {
        content: "OK",
        model: "groq/llama-4-scout",
        provider: "groq",
        latencyMs: 50,
      },
      "groq/llama-4-scout"
    );

    expect(result.usage).toBeUndefined();
  });
});

describe("translateStreamChunk", () => {
  it("converts content chunk to SSE format", () => {
    const line = translateStreamChunk({ content: "Hello", done: false }, "groq/llama-4-scout");

    expect(line).toStartWith("data: ");
    const parsed = JSON.parse(line.slice(6).trim());
    expect(parsed.object).toBe("chat.completion.chunk");
    expect(parsed.choices[0].delta.content).toBe("Hello");
    expect(parsed.choices[0].finish_reason).toBeNull();
  });

  it("converts done chunk to [DONE]", () => {
    const line = translateStreamChunk({ content: "", done: true }, "groq/llama-4-scout");

    expect(line).toBe("data: [DONE]\n\n");
  });

  it("includes usage in a done chunk and appends [DONE]", () => {
    const line = translateStreamChunk(
      {
        content: "",
        done: true,
        usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
      },
      "groq/llama-4-scout"
    );

    expect(line).toInclude("data: [DONE]");
    const parts = line.split("\n\n").filter(Boolean);
    const dataPart = parts[0]!;
    expect(dataPart).toStartWith("data: ");
    const parsed = JSON.parse(dataPart.slice(6));
    expect(parsed.choices).toEqual([]);
    expect(parsed.usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 10,
      total_tokens: 15,
    });
  });
});

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

describe("resolveClientIp", () => {
  it("ignores forwarded headers from an untrusted peer", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "198.51.100.10" },
    });
    expect(resolveClientIp(request, "203.0.113.5", ["10.0.0.1"])).toBe("203.0.113.5");
  });

  it("selects the nearest untrusted address behind trusted proxies", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "198.51.100.10, 10.0.0.2" },
    });
    expect(resolveClientIp(request, "10.0.0.1", ["10.0.0.1", "10.0.0.2"])).toBe("198.51.100.10");
  });
});

describe("Server auth", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 401 when no auth header and apiKey configured", async () => {
    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const authRouter = await createRouter(sabi, { apiKey: "sk-secret" });
    const req = new Request("http://localhost/v1/models");
    const res = await authRouter.fetch(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe("INVALID_API_KEY");
  });

  it("returns 401 on wrong API key", async () => {
    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const authRouter = await createRouter(sabi, { apiKey: "sk-secret" });
    const req = new Request("http://localhost/v1/models", {
      headers: { authorization: "Bearer sk-wrong" },
    });
    const res = await authRouter.fetch(req);
    expect(res.status).toBe(401);
  });

  it("returns 200 on valid API key", async () => {
    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const authRouter = await createRouter(sabi, { apiKey: "sk-secret" });
    const req = new Request("http://localhost/v1/models", {
      headers: { authorization: "Bearer sk-secret" },
    });
    const res = await authRouter.fetch(req);
    expect(res.status).toBe(200);
  });

  it("bypasses auth for /health", async () => {
    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const authRouter = await createRouter(sabi, { apiKey: "sk-secret" });
    const req = new Request("http://localhost/health");
    const res = await authRouter.fetch(req);
    expect(res.status).toBe(200);
  });

  it("allows requests when no apiKey configured", async () => {
    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const noAuthRouter = await createRouter(sabi);
    const req = new Request("http://localhost/v1/models");
    const res = await noAuthRouter.fetch(req);
    expect(res.status).toBe(200);
  });
});

describe("Server rate limiting", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok", role: "assistant" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )) as unknown as typeof globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 429 after exceeding rate limit", async () => {
    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const rateRouter = await createRouter(sabi, { rateLimitRpm: 1 });

    // First request should succeed
    const req1 = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    const res1 = await rateRouter.fetch(req1);
    expect(res1.status).toBe(200);

    // Second request should be rate limited
    const req2 = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    const res2 = await rateRouter.fetch(req2);
    expect(res2.status).toBe(429);
    const body = (await res2.json()) as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe("RATE_LIMIT_EXCEEDED");
    expect(res2.headers.get("Retry-After")).toBeTruthy();
    expect(res2.headers.get("X-RateLimit-Remaining")).toBe("0");
  });
});

describe("Server CORS", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("includes CORS headers on all origins by default", async () => {
    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const corsRouter = await createRouter(sabi);
    const req = new Request("http://localhost/v1/models", {
      method: "OPTIONS",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "GET",
      },
    });
    const res = await corsRouter.fetch(req);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("respects configured CORS origins", async () => {
    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const corsRouter = await createRouter(sabi, {
      corsOrigins: ["https://app.weysabi.co"],
    });
    const req = new Request("http://localhost/v1/models", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.weysabi.co",
        "access-control-request-method": "GET",
      },
    });
    const res = await corsRouter.fetch(req);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.weysabi.co");
  });
});

describe("resolveApiKeys", () => {
  it("creates admin key from apiKey string", () => {
    const keys = resolveApiKeys("sk-admin");
    expect(keys).toHaveLength(1);
    expect(keys[0]!.key).toBe("sk-admin");
    expect(keys[0]!.scopes).toEqual(["admin"]);
  });

  it("passes through ApiKeyEntry array", () => {
    const keys = resolveApiKeys(undefined, [{ key: "sk-chat", scopes: ["chat:write"] }]);
    expect(keys).toHaveLength(1);
    expect(keys[0]!.key).toBe("sk-chat");
    expect(keys[0]!.scopes).toEqual(["chat:write"]);
  });

  it("merges apiKey and apiKeys", () => {
    const keys = resolveApiKeys("sk-admin", [{ key: "sk-chat", scopes: ["chat:write"] }]);
    expect(keys).toHaveLength(2);
    expect(keys[0]!.key).toBe("sk-admin");
    expect(keys[0]!.scopes).toEqual(["admin"]);
    expect(keys[1]!.key).toBe("sk-chat");
    expect(keys[1]!.scopes).toEqual(["chat:write"]);
  });
});

describe("parseApiKeys", () => {
  it("parses simple key without scopes", () => {
    const keys = parseApiKeys("sk-simple");
    expect(keys).toHaveLength(1);
    expect(keys[0]!.key).toBe("sk-simple");
    expect(keys[0]!.scopes).toBeUndefined();
  });

  it("parses key with scopes", () => {
    const keys = parseApiKeys("sk-chat:chat:write");
    expect(keys).toHaveLength(1);
    expect(keys[0]!.key).toBe("sk-chat");
    expect(keys[0]!.scopes).toEqual(["chat:write"]);
  });

  it("parses multiple keys separated by semicolons", () => {
    const keys = parseApiKeys("sk-admin;sk-chat:chat:write;sk-models:models:read");
    expect(keys).toHaveLength(3);
    expect(keys[0]!.key).toBe("sk-admin");
    expect(keys[0]!.scopes).toBeUndefined();
    expect(keys[1]!.key).toBe("sk-chat");
    expect(keys[1]!.scopes).toEqual(["chat:write"]);
    expect(keys[2]!.key).toBe("sk-models");
    expect(keys[2]!.scopes).toEqual(["models:read"]);
  });
});

describe("Scoped auth", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok", role: "assistant" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )) as unknown as typeof globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("chat:write key can access chat completions but not models", async () => {
    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const router = await createRouter(sabi, {
      apiKeys: [{ key: "sk-chat", scopes: ["chat:write"] }],
    });

    const chatReq = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer sk-chat",
      },
      body: JSON.stringify({
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    const chatRes = await router.fetch(chatReq);
    expect(chatRes.status).toBe(200);

    const modelReq = new Request("http://localhost/v1/models", {
      headers: { authorization: "Bearer sk-chat" },
    });
    const modelRes = await router.fetch(modelReq);
    expect(modelRes.status).toBe(403);
  });

  it("models:read key can access models but not chat", async () => {
    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const router = await createRouter(sabi, {
      apiKeys: [{ key: "sk-models", scopes: ["models:read"] }],
    });

    const modelReq = new Request("http://localhost/v1/models", {
      headers: { authorization: "Bearer sk-models" },
    });
    const modelRes = await router.fetch(modelReq);
    expect(modelRes.status).toBe(200);

    const chatReq = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer sk-models",
      },
      body: JSON.stringify({
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    const chatRes = await router.fetch(chatReq);
    expect(chatRes.status).toBe(403);
  });

  it("admin key can access everything", async () => {
    const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
    const router = await createRouter(sabi, {
      apiKeys: [{ key: "sk-admin", scopes: ["admin"] }],
    });

    const modelReq = new Request("http://localhost/v1/models", {
      headers: { authorization: "Bearer sk-admin" },
    });
    expect((await router.fetch(modelReq)).status).toBe(200);

    const chatReq = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer sk-admin",
      },
      body: JSON.stringify({
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    expect((await router.fetch(chatReq)).status).toBe(200);
  });
});

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

describe("Token quotas", () => {
  describe("InMemoryTokenQuotaStore", () => {
    it("reserves and commits actual usage", async () => {
      const store = new InMemoryTokenQuotaStore();
      const result = await store.reserve("key-1", 600, { maxTokensPerMin: 1000 });
      expect(result.allowed).toBeTrue();
      if (!result.allowed) throw new Error("reservation should be allowed");
      await store.commit(result.reservation.id, 400);

      const next = await store.reserve("key-1", 601, { maxTokensPerMin: 1000 });
      expect(next.allowed).toBeFalse();
    });

    it("counts pending reservations atomically", async () => {
      const store = new InMemoryTokenQuotaStore();
      const [first, second] = await Promise.all([
        store.reserve("key-1", 600, { maxTokensPerMin: 1000 }),
        store.reserve("key-1", 600, { maxTokensPerMin: 1000 }),
      ]);

      expect([first.allowed, second.allowed].filter(Boolean)).toHaveLength(1);
      const rejected = first.allowed ? second : first;
      expect(rejected.allowed).toBeFalse();
      if (rejected.allowed) throw new Error("one reservation should be rejected");
      expect(rejected.reason).toInclude("Token quota exceeded");
    });

    it("releases unused reservations", async () => {
      const store = new InMemoryTokenQuotaStore();
      const first = await store.reserve("key-1", 1000, { maxTokensPerMin: 1000 });
      expect(first.allowed).toBeTrue();
      if (!first.allowed) throw new Error("reservation should be allowed");
      await store.release(first.reservation.id);

      const second = await store.reserve("key-1", 1000, { maxTokensPerMin: 1000 });
      expect(second.allowed).toBeTrue();
    });

    it("allows committed usage after the window slides", async () => {
      const store = new InMemoryTokenQuotaStore();
      const result = await store.reserve("key-1", 1000, { maxTokensPerMin: 1000 });
      if (!result.allowed) throw new Error("reservation should be allowed");
      await store.commit(result.reservation.id, 1000);

      const realNow = Date.now;
      Date.now = () => realNow() + 61_000;
      try {
        expect((await store.reserve("key-1", 1000, { maxTokensPerMin: 1000 })).allowed).toBeTrue();
      } finally {
        Date.now = realNow;
      }
    });

    it("tracks keys independently", async () => {
      const store = new InMemoryTokenQuotaStore();
      const first = await store.reserve("key-a", 1000, { maxTokensPerMin: 1000 });
      if (!first.allowed) throw new Error("reservation should be allowed");

      expect((await store.reserve("key-a", 1, { maxTokensPerMin: 1000 })).allowed).toBeFalse();
      expect((await store.reserve("key-b", 1000, { maxTokensPerMin: 1000 })).allowed).toBeTrue();
    });
  });

  describe("API-key fingerprints", () => {
    it("returns a stable SHA-256 fingerprint without exposing the key", async () => {
      const apiKey = "sk-long-secret-key";
      const fingerprint = await fingerprintApiKey(apiKey);

      expect(fingerprint).toHaveLength(64);
      expect(fingerprint).toBe(await fingerprintApiKey(apiKey));
      expect(fingerprint).not.toContain(apiKey);
      expect(fingerprint).not.toContain(apiKey.slice(0, 16));
    });

    it("distinguishes keys with the same prefix", async () => {
      const prefix = "sk-shared-prefix";
      expect(await fingerprintApiKey(`${prefix}-one`)).not.toBe(
        await fingerprintApiKey(`${prefix}-two`)
      );
    });

    it("extracts and fingerprints a Bearer token", async () => {
      const req = new Request("http://localhost", {
        headers: { authorization: "Bearer sk-long-secret-key" },
      });
      expect(await fingerprintRequestApiKey(req)).toBe(
        await fingerprintApiKey("sk-long-secret-key")
      );
    });

    it("returns null without auth header", async () => {
      const req = new Request("http://localhost");
      expect(await fingerprintRequestApiKey(req)).toBeNull();
    });

    it("returns null for empty token", async () => {
      const req = new Request("http://localhost", {
        headers: { authorization: "Bearer " },
      });
      expect(await fingerprintRequestApiKey(req)).toBeNull();
    });
  });

  describe("Route integration", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeAll(() => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "ok", role: "assistant" } }],
              usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        )) as unknown as typeof globalThis.fetch;
    });

    afterAll(() => {
      globalThis.fetch = originalFetch;
    });

    it("returns 429 when token quota exceeded", async () => {
      const store = new InMemoryTokenQuotaStore();
      const existing = await store.reserve(await fingerprintApiKey("sk-quota-key"), 1000, {
        maxTokensPerMin: 1000,
      });
      if (!existing.allowed) throw new Error("reservation should be allowed");
      await store.commit(existing.reservation.id, 1000);
      const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
      const router = await createRouter(sabi, {
        quotaConfig: { maxTokensPerMin: 1000 },
        quotaStore: store,
        apiKey: "sk-quota-key",
      });

      const res = await router.fetch(
        new Request("http://localhost/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer sk-quota-key",
          },
          body: JSON.stringify({
            model: "groq/llama-4-scout",
            messages: [{ role: "user", content: "Hi" }],
          }),
        })
      );

      expect(res.status).toBe(429);
      const body = (await res.json()) as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe("QUOTA_EXCEEDED");
    });

    it("records token usage after successful request", async () => {
      const store = new InMemoryTokenQuotaStore();
      const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
      const router = await createRouter(sabi, {
        quotaConfig: { maxTokensPerMin: 10000 },
        quotaStore: store,
        apiKey: "sk-recording",
      });

      const res = await router.fetch(
        new Request("http://localhost/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer sk-recording",
          },
          body: JSON.stringify({
            model: "groq/llama-4-scout",
            messages: [{ role: "user", content: "Hi" }],
          }),
        })
      );

      expect(res.status).toBe(200);

      const check = await store.reserve(await fingerprintApiKey("sk-recording"), 9971, {
        maxTokensPerMin: 10000,
      });
      expect(check.allowed).toBeFalse();
    });

    it("bypasses quota when no auth key", async () => {
      const store = new InMemoryTokenQuotaStore();
      const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
      const router = await createRouter(sabi, {
        quotaConfig: { maxTokensPerMin: 1 },
        quotaStore: store,
      });

      const res = await router.fetch(
        new Request("http://localhost/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "groq/llama-4-scout",
            messages: [{ role: "user", content: "Hi" }],
          }),
        })
      );

      expect(res.status).toBe(200);
    });

    it("releases the reservation when completion fails", async () => {
      let commits = 0;
      let releases = 0;
      const quotaStore = {
        async reserve(key: string, estimatedTokens: number) {
          return {
            allowed: true as const,
            reservation: { id: "reservation-1", key, reservedTokens: estimatedTokens },
          };
        },
        async commit() {
          commits++;
        },
        async release() {
          releases++;
        },
      };
      const failingSabi = {
        async complete() {
          throw new Error("provider unavailable");
        },
        async *stream() {},
      } as unknown as Weysabi;
      const router = await createRouter(failingSabi, {
        quotaConfig: { maxTokensPerMin: 10_000 },
        quotaStore,
      });

      const response = await router.fetch(
        new Request("http://localhost/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer sk-failing",
          },
          body: JSON.stringify({
            model: "groq/llama-4-scout",
            messages: [{ role: "user", content: "Hi" }],
          }),
        })
      );

      expect(response.status).toBe(500);
      expect(commits).toBe(0);
      expect(releases).toBe(1);
    });

    it("releases the reservation when a stream fails", async () => {
      let commits = 0;
      let releases = 0;
      const quotaStore = {
        async reserve(key: string, estimatedTokens: number) {
          return {
            allowed: true as const,
            reservation: { id: "reservation-1", key, reservedTokens: estimatedTokens },
          };
        },
        async commit() {
          commits++;
        },
        async release() {
          releases++;
        },
      };
      const failingSabi = {
        async complete() {
          throw new Error("unused");
        },
        stream() {
          return {
            [Symbol.asyncIterator]() {
              return {
                next: () => Promise.reject(new Error("stream unavailable")),
              };
            },
          };
        },
      } as unknown as Weysabi;
      const router = await createRouter(failingSabi, {
        quotaConfig: { maxTokensPerMin: 10_000 },
        quotaStore,
      });

      const response = await router.fetch(
        new Request("http://localhost/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer sk-failing-stream",
          },
          body: JSON.stringify({
            model: "groq/llama-4-scout",
            messages: [{ role: "user", content: "Hi" }],
            stream: true,
          }),
        })
      );
      await response.text();

      expect(commits).toBe(0);
      expect(releases).toBe(1);
    });
  });
});

describe("Usage ledger", () => {
  describe("InMemoryUsageLedger", () => {
    it("records and queries by key", async () => {
      const ledger = new InMemoryUsageLedger();
      await ledger.record({
        keyFingerprint: "key-1",
        model: "groq/llama-4-scout",
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        timestamp: Date.now(),
        status: "success",
      });

      const result = await ledger.query({ keyFingerprint: "key-1" });
      expect(result.records).toHaveLength(1);
      expect(result.records[0]!.totalTokens).toBe(30);
    });

    it("returns stats per key", async () => {
      const ledger = new InMemoryUsageLedger();
      await ledger.record({
        keyFingerprint: "key-a",
        model: "gpt-4",
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        estimatedCostUsd: 0.001,
        timestamp: Date.now(),
        status: "success",
      });

      const stats = await ledger.stats("key-a");
      expect(stats.totalRequests).toBe(1);
      expect(stats.totalTokens).toBe(30);
      expect(stats.totalCostUsd).toBeCloseTo(0.001);
      expect(stats.activeKeys).toBe(1);
    });

    it("aggregates across keys", async () => {
      const ledger = new InMemoryUsageLedger();
      await ledger.record({
        keyFingerprint: "key-a",
        model: "gpt-4",
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        timestamp: Date.now(),
        status: "success",
      });
      await ledger.record({
        keyFingerprint: "key-b",
        model: "claude",
        promptTokens: 5,
        completionTokens: 5,
        totalTokens: 10,
        timestamp: Date.now(),
        status: "success",
      });

      const all = await ledger.query();
      expect(all.records).toHaveLength(2);
      expect(all.total).toBe(2);
      expect((await ledger.stats()).activeKeys).toBe(2);
    });

    it("evicts oldest records and returns newest records first", async () => {
      const ledger = new InMemoryUsageLedger(2);
      for (let index = 1; index <= 3; index++) {
        await ledger.record({
          keyFingerprint: `key-${index}`,
          model: "groq/llama-4-scout",
          promptTokens: index,
          completionTokens: index,
          totalTokens: index * 2,
          timestamp: index,
          status: "success",
        });
      }

      const result = await ledger.query();
      expect(result.total).toBe(2);
      expect(result.records.map((record) => record.keyFingerprint)).toEqual(["key-3", "key-2"]);
      expect((await ledger.stats()).activeKeys).toBe(2);
    });
  });
});

describe("Model aliases", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  describe("buildModelAliases", () => {
    it("builds map from ModelAlias config", () => {
      const map = buildModelAliases([
        { alias: "sabi-fast", model: "groq/llama-4-scout" },
        { alias: "sabi-smart", model: "openai/gpt-4o" },
      ]);
      expect(map.get("sabi-fast")).toBe("groq/llama-4-scout");
      expect(map.get("sabi-smart")).toBe("openai/gpt-4o");
      expect(map.size).toBe(2);
    });

    it("parses env var format", () => {
      const map = buildModelAliases(
        undefined,
        "sabi-fast=groq/llama-4-scout,sabi-smart=openai/gpt-4o"
      );
      expect(map.get("sabi-fast")).toBe("groq/llama-4-scout");
      expect(map.get("sabi-smart")).toBe("openai/gpt-4o");
      expect(map.size).toBe(2);
    });

    it("config overrides env var", () => {
      const map = buildModelAliases(
        [{ alias: "sabi-fast", model: "override/model" }],
        "sabi-fast=groq/llama-4-scout"
      );
      expect(map.get("sabi-fast")).toBe("override/model");
    });

    it("handles empty input", () => {
      const map = buildModelAliases();
      expect(map.size).toBe(0);
    });
  });

  describe("resolveAlias", () => {
    it("returns resolved model for known alias", () => {
      const map = buildModelAliases([{ alias: "sabi-fast", model: "groq/llama-4-scout" }]);
      expect(resolveAlias(map, "sabi-fast")).toBe("groq/llama-4-scout");
    });

    it("passes through unknown model", () => {
      const map = buildModelAliases([{ alias: "sabi-fast", model: "groq/llama-4-scout" }]);
      expect(resolveAlias(map, "openai/gpt-4o")).toBe("openai/gpt-4o");
    });

    it("passes through when no aliases configured", () => {
      const map = buildModelAliases();
      expect(resolveAlias(map, "groq/llama-4-scout")).toBe("groq/llama-4-scout");
    });

    it("resolves aliases that reference another alias", () => {
      const map = buildModelAliases([
        { alias: "sabi-default", model: "sabi-fast" },
        { alias: "sabi-fast", model: "groq/llama-4-scout" },
      ]);
      expect(resolveAlias(map, "sabi-default")).toBe("groq/llama-4-scout");
    });

    it("rejects alias cycles", () => {
      const map = buildModelAliases([
        { alias: "alias-a", model: "alias-b" },
        { alias: "alias-b", model: "alias-a" },
      ]);
      expect(() => resolveAlias(map, "alias-a")).toThrow("cycle");
    });
  });

  describe("getAliasesList", () => {
    it("returns sorted alias entries", () => {
      const map = buildModelAliases([{ alias: "sabi-fast", model: "groq/llama-4-scout" }]);
      const list = getAliasesList(map);
      expect(list).toHaveLength(1);
      expect(list[0]!.alias).toBe("sabi-fast");
      expect(list[0]!.model).toBe("groq/llama-4-scout");
    });
  });

  describe("Route integration", () => {
    it("resolves alias in POST /v1/chat/completions", async () => {
      let capturedModel = "";
      const fakeSabi = {
        complete(request: Record<string, unknown>) {
          capturedModel = request.model as string;
          return Promise.resolve({
            content: "Hello",
            model: capturedModel,
            provider: "groq",
            latencyMs: 10,
          });
        },
        stream() {
          return (async function* () {})();
        },
      } as unknown as Weysabi;

      const router = await createRouter(fakeSabi, {
        modelAliases: [{ alias: "sabi-fast", model: "groq/llama-4-scout" }],
      });

      const res = await router.fetch(
        new Request("http://localhost/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "sabi-fast",
            messages: [{ role: "user", content: "Hi" }],
          }),
        })
      );

      expect(res.status).toBe(200);
      expect(capturedModel).toBe("groq/llama-4-scout");
    });

    it("passes through unresolvable models unchanged", async () => {
      let capturedModel = "";
      const fakeSabi = {
        complete(request: Record<string, unknown>) {
          capturedModel = request.model as string;
          return Promise.resolve({
            content: "Hello",
            model: capturedModel,
            provider: "groq",
            latencyMs: 10,
          });
        },
        stream() {
          return (async function* () {})();
        },
      } as unknown as Weysabi;

      const router = await createRouter(fakeSabi, {
        modelAliases: [{ alias: "sabi-fast", model: "groq/llama-4-scout" }],
      });

      const res = await router.fetch(
        new Request("http://localhost/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "groq/llama-4-scout",
            messages: [{ role: "user", content: "Hi" }],
          }),
        })
      );

      expect(res.status).toBe(200);
      expect(capturedModel).toBe("groq/llama-4-scout");
    });

    it("resolves aliases in fallback chains", async () => {
      let capturedFallbacks: string[] = [];
      const fakeSabi = {
        complete(request: Record<string, unknown>) {
          capturedFallbacks = request.fallbacks as string[];
          return Promise.resolve({
            content: "Hello",
            model: request.model as string,
            provider: "groq",
            latencyMs: 10,
          });
        },
        stream() {
          return (async function* () {})();
        },
      } as unknown as Weysabi;
      const router = await createRouter(fakeSabi, {
        modelAliases: [{ alias: "sabi-backup", model: "openai/gpt-4o-mini" }],
      });

      const response = await router.fetch(
        new Request("http://localhost/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "groq/llama-4-scout",
            messages: [{ role: "user", content: "Hi" }],
            sabi_fallbacks: ["sabi-backup"],
          }),
        })
      );

      expect(response.status).toBe(200);
      expect(capturedFallbacks).toEqual(["openai/gpt-4o-mini"]);
    });

    it("GET /v1/models includes aliases", async () => {
      const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
      const router = await createRouter(sabi, {
        modelAliases: [{ alias: "sabi-fast", model: "groq/llama-4-scout" }],
      });

      const res = await router.fetch(new Request("http://localhost/v1/models"));
      const body = (await res.json()) as Record<string, unknown>;
      const data = body.data as Array<Record<string, unknown>>;

      // sabi-proxy + sabi-fast alias
      expect(data).toHaveLength(2);
      const aliasEntry = data.find((entry: Record<string, unknown>) => entry.id === "sabi-fast");
      expect(aliasEntry).toBeTruthy();
      expect(aliasEntry!.owned_by).toBe("groq/llama-4-scout");
    });
  });
});

describe("Admin endpoints", () => {
  describe("Scoped auth", () => {
    it("does not expose admin routes without an explicit admin API key", async () => {
      const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
      const router = await createRouter(sabi);

      const res = await router.fetch(new Request("http://localhost/v1/admin/stats"));
      expect(res.status).toBe(404);
    });

    it("returns 401 when the admin API key is missing or incorrect", async () => {
      const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
      const router = await createRouter(sabi, { adminApiKey: "sk-admin" });

      const missing = await router.fetch(new Request("http://localhost/v1/admin/stats"));
      expect(missing.status).toBe(401);

      const incorrect = await router.fetch(
        new Request("http://localhost/v1/admin/stats", {
          headers: { authorization: "Bearer wrong-key" },
        })
      );
      expect(incorrect.status).toBe(401);
    });

    it("does not accept a normal scoped API key on admin endpoints", async () => {
      const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
      const router = await createRouter(sabi, {
        apiKeys: [{ key: "sk-chat", scopes: ["chat:write"] }],
        adminApiKey: "sk-admin",
      });

      const statsRes = await router.fetch(
        new Request("http://localhost/v1/admin/stats", {
          headers: { authorization: "Bearer sk-chat" },
        })
      );
      expect(statsRes.status).toBe(403);

      const usageRes = await router.fetch(
        new Request("http://localhost/v1/admin/usage", {
          headers: { authorization: "Bearer sk-chat" },
        })
      );
      expect(usageRes.status).toBe(403);
    });

    it("admin key can access admin endpoints", async () => {
      const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
      const router = await createRouter(sabi, { adminApiKey: "sk-admin" });

      const statsRes = await router.fetch(
        new Request("http://localhost/v1/admin/stats", {
          headers: { authorization: "Bearer sk-admin" },
        })
      );
      expect(statsRes.status).toBe(200);

      const usageRes = await router.fetch(
        new Request("http://localhost/v1/admin/usage", {
          headers: { authorization: "Bearer sk-admin" },
        })
      );
      expect(usageRes.status).toBe(200);
    });
  });

  describe("GET /v1/admin/stats", () => {
    it("returns zero stats when no usage recorded", async () => {
      const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
      const router = await createRouter(sabi, { adminApiKey: "sk-admin" });

      const res = await router.fetch(
        new Request("http://localhost/v1/admin/stats", {
          headers: { authorization: "Bearer sk-admin" },
        })
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(body.totalRequests).toBe(0);
      expect(body.totalTokens).toBe(0);
      expect(body.totalCostUsd).toBe(0);
      expect(body.activeKeys).toBe(0);
    });

    it("returns aggregated stats from recorded usage", async () => {
      const ledger = new InMemoryUsageLedger();
      await ledger.record({
        keyFingerprint: "key-1",
        model: "groq/llama-4-scout",
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        estimatedCostUsd: 0.001,
        timestamp: Date.now(),
        status: "success",
      });
      await ledger.record({
        keyFingerprint: "key-2",
        model: "openai/gpt-4o",
        promptTokens: 50,
        completionTokens: 50,
        totalTokens: 100,
        estimatedCostUsd: 0.003,
        timestamp: Date.now(),
        status: "success",
      });

      const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
      const router = await createRouter(sabi, {
        usageLedger: ledger,
        adminApiKey: "sk-admin",
      });

      const res = await router.fetch(
        new Request("http://localhost/v1/admin/stats", {
          headers: { authorization: "Bearer sk-admin" },
        })
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(body.totalRequests).toBe(2);
      expect(body.totalTokens).toBe(130);
      expect(body.totalCostUsd).toBe(0.004);
      expect(body.activeKeys).toBe(2);
    });
  });

  describe("GET /v1/admin/usage", () => {
    it("returns paginated usage records", async () => {
      const ledger = new InMemoryUsageLedger();
      for (let i = 0; i < 10; i++) {
        await ledger.record({
          keyFingerprint: "key-1",
          model: "groq/llama-4-scout",
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          estimatedCostUsd: 0.001,
          timestamp: Date.now() + i,
          status: "success",
        });
      }

      const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
      const router = await createRouter(sabi, {
        usageLedger: ledger,
        adminApiKey: "sk-admin",
      });

      const res = await router.fetch(
        new Request("http://localhost/v1/admin/usage?limit=3&offset=2", {
          headers: { authorization: "Bearer sk-admin" },
        })
      );
      const body = (await res.json()) as { records: unknown[]; total: number };

      expect(body.records).toHaveLength(3);
      expect(body.total).toBe(10);
    });

    it("filters by key fingerprint", async () => {
      const ledger = new InMemoryUsageLedger();
      const keyA = await fingerprintApiKey("key-a");
      const keyB = await fingerprintApiKey("key-b");
      await ledger.record({
        keyFingerprint: keyA,
        model: "groq/llama-4-scout",
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        timestamp: Date.now(),
        status: "success",
      });
      await ledger.record({
        keyFingerprint: keyB,
        model: "openai/gpt-4o",
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        timestamp: Date.now(),
        status: "success",
      });

      const sabi = createWeysabi({ groq: { apiKey: "test-key" } });
      const router = await createRouter(sabi, {
        usageLedger: ledger,
        adminApiKey: "sk-admin",
      });

      const res = await router.fetch(
        new Request(`http://localhost/v1/admin/usage?key=${keyA}`, {
          headers: { authorization: "Bearer sk-admin" },
        })
      );
      const body = (await res.json()) as { records: unknown[]; total: number };

      expect(body.records).toHaveLength(1);
      expect(body.total).toBe(1);
    });

    it("rejects malformed or unbounded pagination", async () => {
      const router = await createRouter(createWeysabi({ groq: { apiKey: "test-key" } }), {
        adminApiKey: "sk-admin",
      });
      const request = (query: string) =>
        router.fetch(
          new Request(`http://localhost/v1/admin/usage?${query}`, {
            headers: { authorization: "Bearer sk-admin" },
          })
        );

      expect((await request("limit=101")).status).toBe(400);
      expect((await request("limit=abc")).status).toBe(400);
      expect((await request("offset=-1")).status).toBe(400);
      expect((await request("key=raw-api-key")).status).toBe(400);
    });
  });
});
