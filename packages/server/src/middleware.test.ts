import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createWeysabi } from "@weysabi/sabi";
import { createRouter } from "./routes";
import { resolveApiKeys, parseApiKeys, resolveClientIp } from "./middleware";

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
