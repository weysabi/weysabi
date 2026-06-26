import { describe, it, expect } from "bun:test";
import { createWeysabi } from "@weysabi/sabi";
import { createRouter } from "./routes";
import { InMemoryUsageLedger } from "./ledger";
import { fingerprintApiKey } from "./quota";

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
