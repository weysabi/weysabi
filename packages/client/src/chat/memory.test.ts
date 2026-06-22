import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync } from "fs";
import { ConversationMemory } from "./memory";

const TEST_DB = ".sabi/test-memory.db";

describe("ConversationMemory", () => {
  let memory: ConversationMemory;

  beforeEach(() => {
    memory = new ConversationMemory({ dbPath: TEST_DB });
  });

  afterEach(async () => {
    await memory.close();
    try {
      unlinkSync(TEST_DB);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(TEST_DB + "-wal");
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(TEST_DB + "-shm");
    } catch {
      /* ignore */
    }
  });

  it("creates a new session on first prepare", async () => {
    const result = await memory.prepare("test-session-1", { message: "Hello" });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({ role: "user", content: "Hello" });
    expect(result.system).toBeUndefined();
    expect(result.historyTruncated).toBe(false);
  });

  it("preserves history across turns", async () => {
    await memory.prepare("multi-turn", { message: "First message" });
    await memory.record("multi-turn", {
      userMessage: { content: "First message" },
      assistantMessage: { content: "First response" },
    });

    await memory.prepare("multi-turn", { message: "Second message" });
    await memory.record("multi-turn", {
      userMessage: { content: "Second message" },
      assistantMessage: { content: "Second response" },
    });

    const history = await memory.getHistory("multi-turn");
    expect(history).toHaveLength(4);
    expect(history[0]).toEqual({ role: "user", content: "First message" });
    expect(history[1]).toEqual({ role: "assistant", content: "First response" });
    expect(history[2]).toEqual({ role: "user", content: "Second message" });
    expect(history[3]).toEqual({ role: "assistant", content: "Second response" });
  });

  it("includes history in prepare context", async () => {
    await memory.prepare("ctx-test", { message: "Turn 1" });
    await memory.record("ctx-test", {
      userMessage: { content: "Turn 1" },
      assistantMessage: { content: "Response 1" },
    });

    const ctx = await memory.prepare("ctx-test", { message: "Turn 2" });
    expect(ctx.messages).toHaveLength(3);
    expect(ctx.messages[0]).toEqual({ role: "user", content: "Turn 1" });
    expect(ctx.messages[1]).toEqual({ role: "assistant", content: "Response 1" });
    expect(ctx.messages[2]).toEqual({ role: "user", content: "Turn 2" });
  });

  it("returns system prompt from prepare", async () => {
    const result = await memory.prepare("sys-test", {
      message: "Hello",
      system: "You are a helpful assistant",
    });

    expect(result.system).toBe("You are a helpful assistant");
    expect(result.messages).toHaveLength(1);
  });

  it("persists system prompt on session", async () => {
    await memory.prepare("persist-sys", {
      message: "Hi",
      system: "Be concise",
    });

    const session = await memory.getSession("persist-sys");
    expect(session?.system).toBe("Be concise");
  });

  it("returns system prompt from session when not passed to prepare", async () => {
    await memory.prepare("reuse-sys", {
      message: "Hi",
      system: "Be concise",
    });

    const result = await memory.prepare("reuse-sys", { message: "Again" });
    expect(result.system).toBe("Be concise");
  });

  it("deletes session and its messages", async () => {
    await memory.prepare("del-test", { message: "Hi" });
    await memory.record("del-test", {
      userMessage: { content: "Hi" },
      assistantMessage: { content: "Bye" },
    });

    await memory.deleteSession("del-test");

    expect(await memory.getSession("del-test")).toBeNull();
    expect(await memory.getHistory("del-test")).toHaveLength(0);
  });

  it("lists sessions ordered by recent activity", async () => {
    await memory.prepare("session-a", { message: "A" });
    await memory.record("session-a", {
      userMessage: { content: "A" },
      assistantMessage: { content: "A response" },
    });
    await memory.prepare("session-b", { message: "B" });

    const sessions = await memory.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
  });

  it("truncates history when exceeding maxHistoryTokens", async () => {
    for (let i = 0; i < 5; i++) {
      await memory.record("trunc-test", {
        userMessage: { content: "x".repeat(2000) },
        assistantMessage: { content: "y".repeat(2000) },
      });
    }

    const result = await memory.prepare("trunc-test", {
      message: "final",
      maxHistoryTokens: 4000,
    });

    expect(result.historyTruncated).toBe(true);
    expect(result.messages).toHaveLength(9);
    expect(await memory.getHistory("trunc-test")).toHaveLength(10);
  });

  it("returns null for nonexistent session", async () => {
    expect(await memory.getSession("nonexistent")).toBeNull();
  });

  it("returns empty history for nonexistent session", async () => {
    expect(await memory.getHistory("nonexistent")).toEqual([]);
  });

  it("accepts a custom store", async () => {
    const custom = new ConversationMemory({
      store: new (await import("./store")).SqliteSessionStore(".sabi/custom-store.db"),
    });
    await custom.prepare("custom-session", { message: "Hello" });
    const session = await custom.getSession("custom-session");
    expect(session?.id).toBe("custom-session");
    await custom.close();
    try {
      unlinkSync(".sabi/custom-store.db");
    } catch {
      /* ignore */
    }
  });
});
