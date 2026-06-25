import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWeysabi } from "./index";
import { AllModelsFailedError } from "./errors";

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

function errorResponse(status: number, text?: string) {
  return new Response(text ?? "Error", { status });
}

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
function setFetch(fn: FetchFn): void {
  globalThis.fetch = fn as typeof globalThis.fetch;
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("stream", () => {
  it("yields content chunks from SSE stream", async () => {
    setFetch(async () =>
      sseResponse(
        `data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}`,
        `data: {"choices":[{"delta":{"content":" world"},"index":0}]}`,
        `data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}`,
        "data: [DONE]"
      )
    );

    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const chunks: string[] = [];

    for await (const chunk of sabi.stream({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Say hi" }],
    })) {
      chunks.push(chunk.content);
      if (chunk.done) break;
    }

    expect(chunks).toEqual(["Hello", " world", ""]);
  });

  it("yields usage chunk when usage is present", async () => {
    setFetch(async () =>
      sseResponse(
        `data: {"choices":[{"delta":{"content":"OK"},"index":0}]}`,
        `data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":10,"total_tokens":15}}`,
        "data: [DONE]"
      )
    );

    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    let gotUsage = false;

    for await (const chunk of sabi.stream({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (chunk.usage) {
        expect(chunk.usage.totalTokens).toBe(15);
        expect(chunk.done).toBe(true);
        gotUsage = true;
      }
    }

    expect(gotUsage).toBe(true);
  });

  it("falls back to next model on connection failure", async () => {
    let attempts = 0;
    setFetch(async () => {
      attempts++;
      if (attempts === 1) return errorResponse(502);
      return sseResponse(
        `data: {"choices":[{"delta":{"content":"OK"},"index":0}]}`,
        `data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}`,
        "data: [DONE]"
      );
    });

    const sabi = createWeysabi(
      {
        groq: { apiKey: "key" },
        nvidia: { apiKey: "key2" },
      },
      { retry: { maxRetries: 0 } }
    );

    const chunks: string[] = [];
    for await (const chunk of sabi.stream({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "hi" }],
      fallbacks: ["nvidia/llama-3.1-8b-instruct"],
    })) {
      chunks.push(chunk.content);
      if (chunk.done) break;
    }

    expect(chunks).toEqual(["OK", ""]);
    expect(attempts).toBe(2);
  });

  it("does not mix fallback output after the primary stream emitted content", async () => {
    let attempts = 0;
    setFetch(async () => {
      attempts++;
      if (attempts > 1) {
        return sseResponse(
          `data: {"choices":[{"delta":{"content":"fallback"},"index":0}]}`,
          `data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}`
        );
      }

      const encoder = new TextEncoder();
      let sent = false;
      return new Response(
        new ReadableStream({
          async pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(
                encoder.encode(`data: {"choices":[{"delta":{"content":"partial"},"index":0}]}\n\n`)
              );
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
            controller.error(new Error("connection lost"));
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } }
      );
    });

    const sabi = createWeysabi(
      {
        groq: { apiKey: "key" },
        nvidia: { apiKey: "key2" },
      },
      { retry: { maxRetries: 0 } }
    );

    const chunks: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of sabi.stream({
          model: "groq/llama-4-scout",
          messages: [{ role: "user", content: "hi" }],
          fallbacks: ["nvidia/llama-3.1-8b-instruct"],
        })) {
          chunks.push(chunk.content);
        }
      })()
    ).rejects.toThrow("fallback was not attempted");

    expect(chunks).toEqual(["partial"]);
    expect(attempts).toBe(1);
  });

  it("throws AllModelsFailedError when all providers fail", async () => {
    setFetch(async () => errorResponse(503));

    const sabi = createWeysabi({ groq: { apiKey: "key" } }, { retry: { maxRetries: 0 } });

    const chunks: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of sabi.stream({
          model: "groq/llama-4-scout",
          messages: [{ role: "user", content: "hi" }],
        })) {
          chunks.push(chunk.content);
        }
      })()
    ).rejects.toThrow(AllModelsFailedError);
  });

  it("renders prompt template and sends as message", async () => {
    let sentBody: unknown;
    setFetch(async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return sseResponse(
        `data: {"choices":[{"delta":{"content":"Bonjour"},"index":0}]}`,
        `data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}`,
        "data: [DONE]"
      );
    });

    const sabi = createWeysabi({ groq: { apiKey: "key" } });
    sabi.prompts.register({
      id: "translate",
      messages: [{ role: "user", content: "Say {word} in French" }],
    });

    const chunks: string[] = [];
    for await (const chunk of sabi.stream({
      model: "groq/llama-4-scout",
      prompt: "translate",
      inputs: { word: "yes" },
    })) {
      chunks.push(chunk.content);
      if (chunk.done) break;
    }

    expect(chunks).toEqual(["Bonjour", ""]);
    expect((sentBody as Record<string, unknown>)?.messages).toEqual([
      { role: "user", content: "Say yes in French" },
    ]);
  });

  it("streams with stream: true in the request body", async () => {
    let sentBody: unknown;
    setFetch(async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return sseResponse(
        `data: {"choices":[{"delta":{"content":"OK"},"index":0}]}`,
        `data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}`,
        "data: [DONE]"
      );
    });

    const sabi = createWeysabi({ groq: { apiKey: "key" } });
    for await (const _chunk of sabi.stream({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "hi" }],
    })) {
      // consume
    }

    expect((sentBody as Record<string, unknown>)?.stream).toBe(true);
  });
});
