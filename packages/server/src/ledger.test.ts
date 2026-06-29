import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { InMemoryUsageLedger, SqliteUsageLedger } from "./ledger";

describe("Usage ledger", () => {
  describe("SqliteUsageLedger", () => {
    let ledger: SqliteUsageLedger;

    beforeEach(async () => {
      ledger = await SqliteUsageLedger.create(":memory:");
    });

    afterEach(() => {
      ledger.close();
    });

    it("records and queries by key", async () => {
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

    it("records error status", async () => {
      await ledger.record({
        keyFingerprint: "key-1",
        model: "groq/llama-4-scout",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        timestamp: Date.now(),
        status: "error",
      });

      const result = await ledger.query({ keyFingerprint: "key-1" });
      expect(result.records).toHaveLength(1);
      expect(result.records[0]!.status).toBe("error");
    });

    it("persists across instances (file-based)", async () => {
      const tmpPath = `.weysabi/test-ledger-${Date.now()}.db`;
      try {
        const ledgerA = await SqliteUsageLedger.create(tmpPath);
        await ledgerA.record({
          keyFingerprint: "key-1",
          model: "groq/llama-4-scout",
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          timestamp: Date.now(),
          status: "success",
        });
        ledgerA.close();

        const ledgerB = await SqliteUsageLedger.create(tmpPath);
        const result = await ledgerB.query({ keyFingerprint: "key-1" });
        expect(result.records).toHaveLength(1);
        expect(result.total).toBe(1);
        ledgerB.close();
      } finally {
        try {
          Bun.spawnSync(["rm", "-f", tmpPath]);
        } catch {
          /* ignore */
        }
      }
    });
  });

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
