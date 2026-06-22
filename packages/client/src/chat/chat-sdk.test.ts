import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync } from "fs";
import { ChatSDK } from "./chat-sdk";
import { ConversationMemory } from "./memory";
import type { ChatAdapter } from "./adapters/adapter";

const TEST_DB = ".sabi/test-chatsdk.db";

function makeAdapter(): ChatAdapter & { callCount: number } {
  let callCount = 0;
  return {
    get callCount() {
      return callCount;
    },
    async complete(req) {
      callCount++;
      const content = req.messages.map((m) => m.content).join(", ");
      return {
        content: `echo: ${content}`,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    },
  };
}

describe("ChatSDK", () => {
  let sdk: ChatSDK;
  let adapter: ChatAdapter & { callCount: number };

  beforeEach(() => {
    adapter = makeAdapter();
    sdk = new ChatSDK({
      adapter,
      memory: new ConversationMemory({ dbPath: TEST_DB }),
    });
  });

  afterEach(async () => {
    await sdk["memory"].close();
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

  it("returns response from adapter", async () => {
    const res = await sdk.chat("test-session", {
      message: "Hello",
      model: "test/model",
    });

    expect(res.content).toContain("Hello");
    expect(res.sessionId).toBe("test-session");
    expect(res.model).toBe("test/model");
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    expect(res.usage?.totalTokens).toBe(15);
    expect(res.historyTruncated).toBe(false);
  });

  it("persists messages across turns", async () => {
    await sdk.chat("multi-turn", {
      message: "First",
      model: "m",
    });
    await sdk.chat("multi-turn", {
      message: "Second",
      model: "m",
    });

    const history = await sdk["memory"].getHistory("multi-turn");
    expect(history).toHaveLength(4);
  });

  it("includes history in subsequent adapter calls", async () => {
    await sdk.chat("history-test", {
      message: "Turn 1",
      model: "m",
    });
    await sdk.chat("history-test", {
      message: "Turn 2",
      model: "m",
    });

    expect(adapter.callCount).toBe(2);
  });

  it("passes system prompt to adapter", async () => {
    let capturedSystem: string | undefined;
    const customSdk = new ChatSDK({
      adapter: {
        async complete(req) {
          capturedSystem = req.system;
          return { content: "ok" };
        },
      },
      memory: new ConversationMemory({ dbPath: TEST_DB + ".sys" }),
    });

    await customSdk.chat("sys-test", {
      message: "Hi",
      model: "m",
      system: "You are helpful",
    });

    expect(capturedSystem).toBe("You are helpful");
    await customSdk["memory"].close();
    try {
      unlinkSync(TEST_DB + ".sys");
    } catch {
      /* ignore */
    }
  });

  it("streams content when adapter supports streaming", async () => {
    const streamingAdapter: ChatAdapter = {
      async *stream(_req) {
        yield { content: "Hello", done: false };
        yield { content: " World", done: false };
        yield {
          content: "",
          usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
          done: true,
        };
      },
      async complete(_req) {
        return { content: "fallback" };
      },
    };

    const streamSdk = new ChatSDK({
      adapter: streamingAdapter,
      memory: new ConversationMemory({ dbPath: TEST_DB + ".stream" }),
    });

    const chunks: string[] = [];
    for await (const chunk of streamSdk.stream("stream-test", {
      message: "Hi",
      model: "m",
    })) {
      chunks.push(chunk.content);
    }

    expect(chunks).toEqual(["Hello", " World", ""]);

    const history = await streamSdk["memory"].getHistory("stream-test");
    expect(history).toHaveLength(2);
    expect(history[1]!.content).toBe("Hello World");

    await streamSdk["memory"].close();
    try {
      unlinkSync(TEST_DB + ".stream");
    } catch {
      /* ignore */
    }
  });

  it("falls back to complete when adapter has no stream method", async () => {
    const noStreamAdapter: ChatAdapter = {
      async complete(_req) {
        return { content: "no-stream-response" };
      },
    };

    const nsSdk = new ChatSDK({
      adapter: noStreamAdapter,
      memory: new ConversationMemory({ dbPath: TEST_DB + ".ns" }),
    });

    const chunks: string[] = [];
    for await (const chunk of nsSdk.stream("ns-test", { message: "Hi", model: "m" })) {
      chunks.push(chunk.content);
    }

    expect(chunks).toEqual(["no-stream-response"]);

    await nsSdk["memory"].close();
    try {
      unlinkSync(TEST_DB + ".ns");
    } catch {
      /* ignore */
    }
  });
});
