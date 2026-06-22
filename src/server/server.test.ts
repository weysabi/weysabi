import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { translateRequest, translateResponse, translateStreamChunk } from "./translate";
import { createRouter } from "./routes";
import { createSabi } from "../index";

describe("translateRequest", () => {
  it("converts OpenAI-style request to Sabi CompleteRequest", () => {
    const result = translateRequest({
      model: "groq/llama-4-scout",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ],
      temperature: 0.7,
      max_tokens: 100,
      top_p: 0.9,
      stop: ["END"],
    });

    expect(result.model).toBe("groq/llama-4-scout");
    expect(result.messages).toHaveLength(2);
    expect(result.temperature).toBe(0.7);
    expect(result.maxTokens).toBe(100);
    expect(result.topP).toBe(0.9);
    expect(result.stop).toEqual(["END"]);
  });

  it("handles minimal request", () => {
    const result = translateRequest({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.model).toBe("groq/llama-4-scout");
    expect(result.messages).toHaveLength(1);
    expect(result.temperature).toBeUndefined();
  });

  it("handles sabi-specific fields", () => {
    const result = translateRequest({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Hi" }],
      sabi_fallbacks: ["openai/gpt-4o-mini"],
      sabi_rag: true,
    });

    expect(result.fallbacks).toEqual(["openai/gpt-4o-mini"]);
    expect(result.rag).toBeTrue();
  });

  it("handles missing messages", () => {
    const result = translateRequest({
      model: "groq/llama-4-scout",
    });

    expect(result.messages).toEqual([]);
  });
});

describe("translateResponse", () => {
  it("converts Sabi CompleteResponse to OpenAI format", () => {
    const result = translateResponse(
      {
        content: "Hello!",
        model: "groq/llama-4-scout",
        provider: "groq",
        latencyMs: 100,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
      "groq/llama-4-scout"
    );

    expect(result.object).toBe("chat.completion");
    expect(result.choices).toHaveLength(1);
    expect((result.choices as Array<Record<string, unknown>>)[0]!.message).toEqual({
      role: "assistant",
      content: "Hello!",
    });
    expect(result.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    });
  });

  it("handles missing usage", () => {
    const result = translateResponse(
      {
        content: "OK",
        model: "groq/llama-4-scout",
        provider: "groq",
        latencyMs: 50,
      },
      "groq/llama-4-scout"
    );

    expect(result.usage).toBeUndefined();
  });
});

describe("translateStreamChunk", () => {
  it("converts content chunk to SSE format", () => {
    const line = translateStreamChunk({ content: "Hello", done: false }, "groq/llama-4-scout");

    expect(line).toStartWith("data: ");
    const parsed = JSON.parse(line.slice(6).trim());
    expect(parsed.object).toBe("chat.completion.chunk");
    expect(parsed.choices[0].delta.content).toBe("Hello");
    expect(parsed.choices[0].finish_reason).toBeNull();
  });

  it("converts done chunk to [DONE]", () => {
    const line = translateStreamChunk({ content: "", done: true }, "groq/llama-4-scout");

    expect(line).toBe("data: [DONE]\n\n");
  });

  it("includes usage in final chunk and appends [DONE]", () => {
    const line = translateStreamChunk(
      {
        content: "Done",
        done: false,
        usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
      },
      "groq/llama-4-scout"
    );

    expect(line).toInclude("data: [DONE]");
    const parts = line.split("\n\n").filter(Boolean);
    const dataPart = parts[0]!;
    expect(dataPart).toStartWith("data: ");
    const parsed = JSON.parse(dataPart.slice(6));
    expect(parsed.choices[0].finish_reason).toBe("stop");
  });
});

describe("Server integration", () => {
  let router: { fetch: (req: Request) => Response | Promise<Response> };
  let originalFetch: typeof globalThis.fetch;

  function mockJsonResponse(): void {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Hello from mock", role: "assistant" } }],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            model: "llama-4-scout",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )) as unknown as typeof globalThis.fetch;
  }

  function mockStreamResponse(): void {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`
          )
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [{ delta: {}, finish_reason: "stop" }],
            })}\n\n`
          )
        );
        controller.close();
      },
    });
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      )) as unknown as typeof globalThis.fetch;
  }

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    mockJsonResponse();
    const sabi = createSabi({ groq: { apiKey: "test-key" } });
    router = await createRouter(sabi);
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("POST /v1/chat/completions returns valid OpenAI-compatible response", async () => {
    mockJsonResponse();
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const choices = body.choices as Array<Record<string, unknown>>;
    const usage = body.usage as Record<string, unknown>;
    expect(body.object).toBe("chat.completion");
    expect(choices).toHaveLength(1);
    expect((choices[0]!.message as Record<string, unknown>).content).toBe("Hello from mock");
    expect((choices[0]!.message as Record<string, unknown>).role).toBe("assistant");
    expect(usage.prompt_tokens).toBe(5);
    expect(body.model).toBe("groq/llama-4-scout");
  });

  it("POST /v1/chat/completions with stream=true returns SSE", async () => {
    mockStreamResponse();
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      }),
    });

    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const text = await res.text();
    expect(text).toInclude("data: ");
    expect(text).toInclude("[DONE]");
    const lines = text.split("\n").filter(Boolean);
    const dataLine = lines.find((l) => l.startsWith("data: ") && l !== "data: [DONE]");
    expect(dataLine).toBeTruthy();
    const parsed = JSON.parse(dataLine!.slice(6));
    expect(parsed.object).toBe("chat.completion.chunk");
  });

  it("GET /v1/models returns model list", async () => {
    const req = new Request("http://localhost/v1/models");
    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const data = body.data as Array<Record<string, unknown>>;
    expect(body.object).toBe("list");
    expect(data).toHaveLength(1);
    expect(data[0]!.id).toBe("sabi-proxy");
  });

  it("GET /health returns ok", async () => {
    const req = new Request("http://localhost/health");
    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.timestamp as number).toBeGreaterThan(0);
  });

  it("returns 500 on provider error", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("Internal error", { status: 500 })
      )) as unknown as typeof globalThis.fetch;

    const errSabi = createSabi({ groq: { apiKey: "test-key" } });
    const errorRouter = await createRouter(errSabi);

    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "groq/llama-4-scout",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    const res = await errorRouter.fetch(req);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    const error = body.error as Record<string, unknown>;
    expect(error.message).toBeTruthy();
    expect(error.type).toBe("sabi_error");
  });
});
