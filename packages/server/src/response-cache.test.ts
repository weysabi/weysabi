import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createWeysabi, InMemoryCache } from "weysabi";
import { createRouter } from "./routes";

describe("Server response caching", () => {
  let originalFetch: typeof globalThis.fetch;

  function mockFetch(callLog: number[]): void {
    globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit) => {
      callLog.push(callLog.length);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: `response-${callLog.length}`, role: "assistant" } }],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    }) as unknown as typeof globalThis.fetch;
  }

  beforeAll(() => {
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns cached response on second identical request", async () => {
    const callLog: number[] = [];
    mockFetch(callLog);

    const cache = new InMemoryCache(60_000);
    const weysabi = createWeysabi({ groq: { apiKey: "test" } });
    const router = await createRouter(weysabi, {
      apiKey: "sk-test",
      responseCache: cache,
    });

    const body = {
      model: "groq/llama-4-scout",
      messages: [{ role: "user" as const, content: "Hello" }],
    };

    const req1 = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-test" },
      body: JSON.stringify(body),
    });
    const res1 = await router.fetch(req1);
    expect(res1.status).toBe(200);
    const data1 = (await res1.json()) as { choices: Array<{ message: { content: string } }> };
    expect(data1.choices[0]?.message?.content).toBe("response-1");
    expect(callLog.length).toBe(1);

    const req2 = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-test" },
      body: JSON.stringify(body),
    });
    const res2 = await router.fetch(req2);
    expect(res2.status).toBe(200);
    const data2 = (await res2.json()) as { choices: Array<{ message: { content: string } }> };
    expect(data2.choices[0]?.message?.content).toBe("response-1");
    expect(callLog.length).toBe(1);
  });

  it("cache miss calls provider for different request", async () => {
    const callLog: number[] = [];
    mockFetch(callLog);

    const cache = new InMemoryCache(60_000);
    const weysabi = createWeysabi({ groq: { apiKey: "test" } });
    const router = await createRouter(weysabi, {
      apiKey: "sk-test",
      responseCache: cache,
    });

    const res1 = await router.fetch(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer sk-test" },
        body: JSON.stringify({
          model: "groq/llama-4-scout",
          messages: [{ role: "user" as const, content: "First" }],
        }),
      })
    );
    expect(res1.status).toBe(200);
    expect(callLog.length).toBe(1);

    const res2 = await router.fetch(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer sk-test" },
        body: JSON.stringify({
          model: "groq/llama-4-scout",
          messages: [{ role: "user" as const, content: "Second" }],
        }),
      })
    );
    expect(res2.status).toBe(200);
    expect(callLog.length).toBe(2);
  });

  it("does not cache streaming requests", async () => {
    const callLog: number[] = [];
    mockFetch(callLog);

    const cache = new InMemoryCache(60_000);
    const weysabi = createWeysabi({ groq: { apiKey: "test" } });
    const router = await createRouter(weysabi, {
      apiKey: "sk-test",
      responseCache: cache,
    });

    const body = {
      model: "groq/llama-4-scout",
      messages: [{ role: "user" as const, content: "Hi" }],
      stream: true,
    };

    const req1 = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-test" },
      body: JSON.stringify(body),
    });
    await router.fetch(req1);
    expect(callLog.length).toBe(1);

    const req2 = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-test" },
      body: JSON.stringify(body),
    });
    await router.fetch(req2);
    expect(callLog.length).toBe(2);
  });

  it("bypasses quota check on cache hit", async () => {
    const callLog: number[] = [];
    mockFetch(callLog);

    const cache = new InMemoryCache(60_000);
    const weysabi = createWeysabi({ groq: { apiKey: "test" } });
    const store = new (await import("./quota")).InMemoryTokenQuotaStore();

    const router = await createRouter(weysabi, {
      quotaConfig: { maxTokensPerMin: 10000 },
      quotaStore: store,
      responseCache: cache,
    });

    const body = {
      model: "groq/llama-4-scout",
      messages: [{ role: "user" as const, content: "Hello" }],
    };

    const req1 = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-test" },
      body: JSON.stringify(body),
    });
    const res1 = await router.fetch(req1);
    expect(res1.status).toBe(200);

    const req2 = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-test" },
      body: JSON.stringify(body),
    });
    const res2 = await router.fetch(req2);
    expect(res2.status).toBe(200);
    const data2 = (await res2.json()) as { choices: Array<{ message: { content: string } }> };
    expect(data2.choices[0]?.message?.content).toBe("response-1");
    expect(callLog.length).toBe(1);
  });
});
