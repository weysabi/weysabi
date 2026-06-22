import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWeysabi } from "./index";
import { InMemoryCache, RedisCache } from "./cache";
import type { CompleteResponse } from "./types";

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
function setFetch(fn: FetchFn): void {
  globalThis.fetch = fn as typeof globalThis.fetch;
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  setFetch(async () => okResponse({ choices: [{ message: { content: "" } }] }));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("InMemoryCache", () => {
  it("stores and retrieves values", async () => {
    const cache = new InMemoryCache();
    const value: CompleteResponse = {
      content: "hello",
      model: "groq/llama-3.1-8b-instant",
      provider: "groq",
      latencyMs: 100,
    };

    await cache.set("key1", value);
    const result = await cache.get("key1");
    expect(result?.content).toBe("hello");
  });

  it("returns null for missing keys", async () => {
    const cache = new InMemoryCache();
    const result = await cache.get("nonexistent");
    expect(result).toBeNull();
  });

  it("expires entries after TTL", async () => {
    const cache = new InMemoryCache(50);
    const value: CompleteResponse = {
      content: "hello",
      model: "groq/llama-3.1-8b-instant",
      provider: "groq",
      latencyMs: 100,
    };

    await cache.set("key1", value);
    expect(await cache.get("key1")).not.toBeNull();

    await new Promise((r) => setTimeout(r, 60));
    expect(await cache.get("key1")).toBeNull();
  });

  it("clear removes all entries", async () => {
    const cache = new InMemoryCache();
    await cache.set("a", {
      content: "a",
      model: "m",
      provider: "p",
      latencyMs: 0,
    });
    await cache.set("b", {
      content: "b",
      model: "m",
      provider: "p",
      latencyMs: 0,
    });
    expect(cache.size()).toBe(2);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});

describe("sabi cache integration", () => {
  it("caches complete responses", async () => {
    let callCount = 0;
    setFetch(async () => {
      callCount++;
      return okResponse({
        choices: [{ message: { content: `response-${callCount}` } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    });

    const cache = new InMemoryCache(60_000);
    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } }, { cache });

    const req = {
      model: "groq/llama-3.1-8b-instant",
      messages: [{ role: "user" as const, content: "hi" }],
    };

    const result1 = await sabi.complete(req);
    expect(result1.content).toBe("response-1");
    expect(callCount).toBe(1);

    const result2 = await sabi.complete(req);
    expect(result2.content).toBe("response-1");
    expect(callCount).toBe(1);
  });

  it("cache miss calls provider", async () => {
    let callCount = 0;
    setFetch(async () => {
      callCount++;
      return okResponse({
        choices: [{ message: { content: `r${callCount}` } }],
      });
    });

    const cache = new InMemoryCache(60_000);
    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } }, { cache });

    const r1 = await sabi.complete({
      model: "groq/llama-3.1-8b-instant",
      messages: [{ role: "user" as const, content: "a" }],
    });
    const r2 = await sabi.complete({
      model: "groq/llama-3.1-8b-instant",
      messages: [{ role: "user" as const, content: "b" }],
    });

    expect(r1.content).toBe("r1");
    expect(r2.content).toBe("r2");
    expect(callCount).toBe(2);
  });
});

describe("RedisCache", () => {
  function createMockRedis() {
    const store = new Map<string, string>();
    const ttlMap = new Map<string, number>();

    return {
      store,
      ttlMap,
      client: {
        async get(key: string): Promise<string | null> {
          const expiresAt = ttlMap.get(key);
          if (expiresAt !== undefined && Date.now() > expiresAt) {
            store.delete(key);
            ttlMap.delete(key);
            return null;
          }
          return store.get(key) ?? null;
        },
        async set(key: string, value: string, options?: { PX?: number }): Promise<"OK"> {
          store.set(key, value);
          if (options?.PX) {
            ttlMap.set(key, Date.now() + options.PX);
          }
          return "OK";
        },
        async del(key: string): Promise<number> {
          store.delete(key);
          ttlMap.delete(key);
          return 1;
        },
      },
    };
  }

  it("stores and retrieves values", async () => {
    const { client } = createMockRedis();
    const cache = new RedisCache(client);

    await cache.set("key1", {
      content: "hello",
      model: "groq/llama-3.1-8b-instant",
      provider: "groq",
      latencyMs: 100,
    });

    const result = await cache.get("key1");
    expect(result?.content).toBe("hello");
  });

  it("returns null for missing keys", async () => {
    const { client } = createMockRedis();
    const cache = new RedisCache(client);

    const result = await cache.get("nonexistent");
    expect(result).toBeNull();
  });

  it("expires entries after TTL", async () => {
    const { client } = createMockRedis();
    const cache = new RedisCache(client, 50);

    await cache.set("key1", {
      content: "hello",
      model: "groq/llama-3.1-8b-instant",
      provider: "groq",
      latencyMs: 100,
    });

    expect(await cache.get("key1")).not.toBeNull();

    await new Promise((r) => setTimeout(r, 60));
    expect(await cache.get("key1")).toBeNull();
  });

  it("handles corrupted JSON gracefully", async () => {
    const { client } = createMockRedis();
    const cache = new RedisCache(client);

    await client.set("corrupt", "not-json");
    const result = await cache.get("corrupt");
    expect(result).toBeNull();
  });

  it("works with sabi complete via cache", async () => {
    let callCount = 0;
    setFetch(async () => {
      callCount++;
      return okResponse({
        choices: [{ message: { content: `r-${callCount}` } }],
      });
    });

    const { client } = createMockRedis();
    const cache = new RedisCache(client, 60_000);
    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } }, { cache });

    const req = {
      model: "groq/llama-3.1-8b-instant",
      messages: [{ role: "user" as const, content: "hi" }],
    };

    const r1 = await sabi.complete(req);
    expect(r1.content).toBe("r-1");
    expect(callCount).toBe(1);

    const r2 = await sabi.complete(req);
    expect(r2.content).toBe("r-1");
    expect(callCount).toBe(1);
  });
});
