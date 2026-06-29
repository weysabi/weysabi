import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createWeysabi } from "weysabi";
import { createWsHandler } from "./ws";
import { buildModelAliases } from "./aliases";

function mockWebSocket(): WebSocket {
  const messages: string[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    send(data: string) {
      messages.push(data);
    },
    close() {},
  } as unknown as WebSocket;
  (ws as unknown as { _messages: string[] })._messages = messages;
  return ws;
}

function getMessages(ws: WebSocket): string[] {
  return (ws as unknown as { _messages: string[] })._messages;
}

describe("WS handler — WebSocket", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Hello!", role: "assistant" } }],
            usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )) as unknown as typeof globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("responds to a valid chat message", async () => {
    const weysabi = createWeysabi({ groq: { apiKey: "test" } });
    const { handleMessage } = createWsHandler({
      weysabi,
      modelAliases: buildModelAliases(),
    });

    const ws = mockWebSocket();
    await handleMessage(
      ws,
      JSON.stringify({
        type: "chat",
        id: "req-1",
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hi" }],
      })
    );

    const msgs = getMessages(ws);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    const last = JSON.parse(msgs[msgs.length - 1]!) as Record<string, unknown>;
    expect(last.type).toBe("done");
    expect(last.id).toBe("req-1");
  });

  it("rejects missing fields", async () => {
    const weysabi = createWeysabi({ groq: { apiKey: "test" } });
    const { handleMessage } = createWsHandler({
      weysabi,
      modelAliases: buildModelAliases(),
    });

    const ws = mockWebSocket();
    await handleMessage(ws, JSON.stringify({ type: "chat", id: "req-1" }));

    const msgs = getMessages(ws);
    expect(msgs).toHaveLength(1);
    const parsed = JSON.parse(msgs[0]!) as Record<string, unknown>;
    expect(parsed.type).toBe("error");
  });

  it("rejects invalid JSON", async () => {
    const weysabi = createWeysabi({ groq: { apiKey: "test" } });
    const { handleMessage } = createWsHandler({
      weysabi,
      modelAliases: buildModelAliases(),
    });

    const ws = mockWebSocket();
    await handleMessage(ws, "not json");

    const msgs = getMessages(ws);
    expect(msgs).toHaveLength(1);
    const parsed = JSON.parse(msgs[0]!) as Record<string, unknown>;
    expect(parsed.type).toBe("error");
  });
});

describe("WS handler — HTTP fallback", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Hi!", role: "assistant" } }],
            usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )) as unknown as typeof globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns SSE stream for valid chat message", async () => {
    const weysabi = createWeysabi({ groq: { apiKey: "test" } });
    const { handleHttp } = createWsHandler({
      weysabi,
      modelAliases: buildModelAliases(),
    });

    const req = new Request("http://localhost/v1/ws", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "chat",
        id: "req-2",
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const res = await handleHttp(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const text = await res.text();
    expect(text).toContain('"type":"done"');
    expect(text).toContain('"id":"req-2"');
  });

  it("returns 400 for missing fields", async () => {
    const weysabi = createWeysabi({ groq: { apiKey: "test" } });
    const { handleHttp } = createWsHandler({
      weysabi,
      modelAliases: buildModelAliases(),
    });

    const req = new Request("http://localhost/v1/ws", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "chat", id: "req-3" }),
    });

    const res = await handleHttp(req);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Missing required fields");
  });

  it("returns 400 for invalid JSON", async () => {
    const weysabi = createWeysabi({ groq: { apiKey: "test" } });
    const { handleHttp } = createWsHandler({
      weysabi,
      modelAliases: buildModelAliases(),
    });

    const req = new Request("http://localhost/v1/ws", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });

    const res = await handleHttp(req);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Invalid JSON");
  });

  it("returns 429 when quota exceeded", async () => {
    const weysabi = createWeysabi({ groq: { apiKey: "test" } });
    const store = new (await import("./quota")).InMemoryTokenQuotaStore();
    const key = await (await import("./quota")).fingerprintApiKey("sk-limited-key");
    const { handleHttp } = createWsHandler({
      weysabi,
      modelAliases: buildModelAliases(),
      quotaConfig: { maxTokensPerMin: 10 },
      quotaStore: store,
    });

    const reservation = await store.reserve(key, 10, { maxTokensPerMin: 10 });
    if (!reservation.allowed) throw new Error("reservation should be allowed");
    await store.commit(reservation.reservation.id, 10);

    const req = new Request("http://localhost/v1/ws?apiKey=sk-limited-key", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer sk-limited-key",
      },
      body: JSON.stringify({
        type: "chat",
        id: "req-quota",
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    const res = await handleHttp(req);
    expect(res.status).toBe(429);
    const text = await res.text();
    expect(text).toContain("QUOTA_EXCEEDED");
  });
});
