import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWeysabi } from "./index";
import type { Plugin, CompleteResponse } from "./types";

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(...events: string[]) {
  const body = events.join("\n") + "\n";
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
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

describe("sabi.use", () => {
  it("registers a plugin without throwing", () => {
    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const plugin: Plugin = { name: "test" };
    sabi.use(plugin);
  });

  it("calls onCompleteRequest before complete", async () => {
    setFetch(async () => okResponse({ choices: [{ message: { content: "ok" } }] }));
    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    let called = false;

    sabi.use({
      name: "spy",
      onCompleteRequest(req) {
        called = true;
        return req;
      },
    });

    await sabi.complete({
      model: "groq/llama-3.1-8b-instant",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(called).toBe(true);
  });

  it("onCompleteRequest can transform the request", async () => {
    let sentBody: unknown;
    setFetch(async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return okResponse({ choices: [{ message: { content: "ok" } }] });
    });

    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });

    sabi.use({
      name: "uppercase",
      onCompleteRequest(req) {
        return {
          ...req,
          messages: (req.messages ?? []).map((m) => ({
            ...m,
            content: (m.content ?? "").toUpperCase(),
          })),
        };
      },
    });

    await sabi.complete({
      model: "groq/llama-3.1-8b-instant",
      messages: [{ role: "user", content: "hello" }],
    });

    const body = sentBody as Record<string, unknown>;
    const msgs = body.messages as Array<Record<string, unknown>> | undefined;
    expect(msgs?.[0]?.content).toBe("HELLO");
  });

  it("calls onCompleteResponse after complete", async () => {
    setFetch(async () =>
      okResponse({
        choices: [{ message: { content: "original" } }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      })
    );

    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    let captured: CompleteResponse | undefined;

    sabi.use({
      name: "spy",
      onCompleteResponse(res) {
        captured = res;
        return res;
      },
    });

    await sabi.complete({
      model: "groq/llama-3.1-8b-instant",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(captured).toBeDefined();
    expect(captured!.content).toBe("original");
    expect(captured!.usage?.totalTokens).toBe(3);
  });

  it("onCompleteResponse can transform the response", async () => {
    setFetch(async () =>
      okResponse({
        choices: [{ message: { content: "hello world" } }],
      })
    );

    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });

    sabi.use({
      name: "suffix",
      onCompleteResponse(res) {
        return { ...res, content: res.content + "!" };
      },
    });

    const result = await sabi.complete({
      model: "groq/llama-3.1-8b-instant",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.content).toBe("hello world!");
  });

  it("calls onCompleteRequest in registration order", async () => {
    setFetch(async () => okResponse({ choices: [{ message: { content: "ok" } }] }));
    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const order: number[] = [];

    sabi.use({
      name: "first",
      onCompleteRequest(req) {
        order.push(1);
        return req;
      },
    });

    sabi.use({
      name: "second",
      onCompleteRequest(req) {
        order.push(2);
        return req;
      },
    });

    await sabi.complete({
      model: "groq/llama-3.1-8b-instant",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(order).toEqual([1, 2]);
  });

  it("calls onError on complete failure", async () => {
    setFetch(async () => new Response("Error", { status: 500 }));
    const sabi = createWeysabi({ groq: { apiKey: "key" } }, { retry: { maxRetries: 0 } });
    let errorCalled = false;

    sabi.use({
      name: "error-logger",
      onError(_err, _ctx) {
        errorCalled = true;
      },
    });

    await expect(
      sabi.complete({
        model: "groq/llama-3.1-8b-instant",
        messages: [{ role: "user", content: "hi" }],
      })
    ).rejects.toThrow();

    expect(errorCalled).toBe(true);
  });

  it("calls onStreamRequest before stream", async () => {
    setFetch(async () =>
      sseResponse(
        `data: {"choices":[{"delta":{"content":"ok"},"index":0}]}`,
        `data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}`,
        "data: [DONE]"
      )
    );
    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    let called = false;

    sabi.use({
      name: "spy",
      onStreamRequest(req) {
        called = true;
        return req;
      },
    });

    for await (const _chunk of sabi.stream({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "hi" }],
    })) {
      // consume
    }

    expect(called).toBe(true);
  });

  it("onStreamRequest can transform the request", async () => {
    let sentBody: unknown;
    setFetch(async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return sseResponse(
        `data: {"choices":[{"delta":{"content":"OK"},"index":0}]}`,
        `data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}`,
        "data: [DONE]"
      );
    });

    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });

    sabi.use({
      name: "uppercase",
      onStreamRequest(req) {
        return {
          ...req,
          messages: (req.messages ?? []).map((m) => ({
            ...m,
            content: (m.content ?? "").toUpperCase(),
          })),
        };
      },
    });

    for await (const _chunk of sabi.stream({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "hello" }],
    })) {
      // consume
    }

    const body = sentBody as Record<string, unknown>;
    const msgs = body.messages as Array<Record<string, unknown>> | undefined;
    expect(msgs?.[0]?.content).toBe("HELLO");
  });

  it("calls onError on stream failure", async () => {
    setFetch(async () => new Response("Error", { status: 503 }));
    const sabi = createWeysabi({ groq: { apiKey: "key" } }, { retry: { maxRetries: 0 } });
    let errorCalled = false;

    sabi.use({
      name: "error-logger",
      onError(_err, _ctx) {
        errorCalled = true;
      },
    });

    await expect(
      (async () => {
        for await (const _chunk of sabi.stream({
          model: "groq/llama-4-scout",
          messages: [{ role: "user", content: "hi" }],
        })) {
          // consume
        }
      })()
    ).rejects.toThrow();

    expect(errorCalled).toBe(true);
  });
});
