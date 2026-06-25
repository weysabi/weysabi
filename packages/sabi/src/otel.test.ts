import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWeysabi } from "./index";
import { createOtelPlugin } from "./otel";
import type { OtelSpan, OtelTracer } from "./otel";

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number) {
  return new Response("Error", { status });
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

describe("createOtelPlugin", () => {
  it("creates a span on complete and ends it on response", async () => {
    setFetch(async () =>
      okResponse({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      })
    );

    const attributes: Record<string, unknown> = {};
    let spanEnded = false;

    const fakeSpan: OtelSpan = {
      setAttribute(key, value) {
        attributes[key] = value;
      },
      end() {
        spanEnded = true;
      },
      recordException(_error: Error) {},
      setStatus(_status: { code: number; message?: string }) {},
    };

    const fakeTracer: OtelTracer = {
      startSpan(_name, _opts) {
        if (_opts?.attributes) {
          Object.assign(attributes, _opts.attributes);
        }
        return fakeSpan;
      },
    };

    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    sabi.use(createOtelPlugin({ tracer: fakeTracer }));

    const result = await sabi.complete({
      model: "groq/llama-3.1-8b-instant",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(spanEnded).toBe(true);
    expect(attributes["sabi.model"]).toBe("groq/llama-3.1-8b-instant");
    expect(attributes["sabi.latency_ms"]).toBe(result.latencyMs);
    expect(attributes["sabi.total_tokens"]).toBe(15);
  });

  it("records exception on complete error", async () => {
    setFetch(async () => errorResponse(500));
    const sabi = createWeysabi({ groq: { apiKey: "key" } }, { retry: { maxRetries: 0 } });

    let recordedException: Error | undefined;
    let statusCode = 0;

    const fakeSpan: OtelSpan = {
      setAttribute(_key, _value) {},
      end() {},
      recordException(error: Error) {
        recordedException = error;
      },
      setStatus(status: { code: number; message?: string }) {
        statusCode = status.code;
      },
    };

    const fakeTracer: OtelTracer = {
      startSpan(_name, _opts) {
        return fakeSpan;
      },
    };

    sabi.use(createOtelPlugin({ tracer: fakeTracer }));

    await expect(
      sabi.complete({
        model: "groq/llama-3.1-8b-instant",
        messages: [{ role: "user", content: "hi" }],
      })
    ).rejects.toThrow();

    expect(recordedException).toBeDefined();
    expect(statusCode).toBe(2);
  });

  it("creates a span on stream and ends it on error", async () => {
    setFetch(async () => errorResponse(503));
    const sabi = createWeysabi({ groq: { apiKey: "key" } }, { retry: { maxRetries: 0 } });

    let spanEnded = false;
    let recordedException: Error | undefined;

    const fakeSpan: OtelSpan = {
      setAttribute(_key, _value) {},
      end() {
        spanEnded = true;
      },
      recordException(error: Error) {
        recordedException = error;
      },
      setStatus(_status: { code: number; message?: string }) {},
    };

    const fakeTracer: OtelTracer = {
      startSpan(_name, _opts) {
        return fakeSpan;
      },
    };

    sabi.use(createOtelPlugin({ tracer: fakeTracer }));

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

    expect(spanEnded).toBe(true);
    expect(recordedException).toBeDefined();
  });

  it("ends a span when a stream completes successfully", async () => {
    setFetch(
      async () =>
        new Response(
          `data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n`,
          { status: 200, headers: { "content-type": "text/event-stream" } }
        )
    );

    let spanEnded = false;
    const fakeSpan: OtelSpan = {
      setAttribute(_key, _value) {},
      end() {
        spanEnded = true;
      },
      recordException(_error: Error) {},
      setStatus(_status: { code: number; message?: string }) {},
    };
    const fakeTracer: OtelTracer = {
      startSpan() {
        return fakeSpan;
      },
    };

    const sabi = createWeysabi({ groq: { apiKey: "key" } });
    sabi.use(createOtelPlugin({ tracer: fakeTracer }));

    for await (const _chunk of sabi.stream({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "hi" }],
    })) {
      // consume
    }

    expect(spanEnded).toBe(true);
  });
});
