import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createWeysabi } from "@weysabi/sabi";
import type { Weysabi } from "@weysabi/sabi";
import { createRouter } from "./routes";
import { fingerprintApiKey, fingerprintRequestApiKey, InMemoryTokenQuotaStore } from "./quota";

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
