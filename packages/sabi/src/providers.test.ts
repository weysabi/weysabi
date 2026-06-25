import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWeysabi } from "./index";
import { ProviderClient } from "./providers";
import { openaiHandler } from "./providers/openai";
import type { ResolvedWeysabiOptions } from "./types";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Params = {
  timeout: number;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string | string[];
  responseFormat?: Record<string, unknown>;
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function setFetch(fn: FetchFn): void {
  globalThis.fetch = fn as typeof globalThis.fetch;
}

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const opts: ResolvedWeysabiOptions = {
  timeout: 30_000,
  retry: { maxRetries: 0, statusCodes: [], backoffMs: 1000 },
  circuitBreaker: { threshold: 5, cooldownMs: 30_000, windowMs: 60_000 },
};

const defaultParams: Params = { timeout: 30_000 };

describe("OpenAI-compatible provider", () => {
  it("requests usage in streaming responses", () => {
    const body = openaiHandler.buildBody("gpt-4o-mini", [{ role: "user", content: "Hi" }], {
      stream: true,
      includeUsage: true,
      responseFormat: { type: "json_object" },
    });

    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.response_format).toEqual({ type: "json_object" });
  });
});

describe("anthropic provider", () => {
  it("builds correct request and parses response", async () => {
    let sentUrl = "";
    let sentHeaders: Record<string, string> = {};
    let sentBody: unknown;

    setFetch(async (url, init) => {
      sentUrl = url.toString();
      sentHeaders = (init?.headers ?? {}) as Record<string, string>;
      sentBody = JSON.parse(init?.body as string);
      return okResponse({
        content: [{ type: "text", text: "Hello from Claude" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    });

    const client = new ProviderClient("anthropic", { apiKey: "sk-ant-abc" }, opts);
    const result = await client.complete(
      "claude-3-5-sonnet-20241022",
      [{ role: "user", content: "Hi" }],
      defaultParams
    );

    expect(sentUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(sentHeaders["x-api-key"]).toBe("sk-ant-abc");
    expect(sentHeaders["anthropic-version"]).toBe("2023-06-01");
    expect((sentBody as Record<string, unknown>).model).toBe("claude-3-5-sonnet-20241022");
    expect(result.content).toBe("Hello from Claude");
    expect(result.usage?.promptTokens).toBe(10);
    expect(result.usage?.completionTokens).toBe(5);
    expect(result.usage?.totalTokens).toBe(15);
  });

  it("defaults max_tokens to 1024", async () => {
    let sentBody: unknown;
    setFetch(async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return okResponse({ content: [{ type: "text", text: "OK" }] });
    });

    const client = new ProviderClient("anthropic", { apiKey: "sk-ant-abc" }, opts);
    await client.complete(
      "claude-3-5-sonnet-20241022",
      [{ role: "user", content: "Hi" }],
      defaultParams
    );

    expect((sentBody as Record<string, unknown>).max_tokens).toBe(1024);
  });

  it("sends system messages through the Anthropic system field", async () => {
    let sentBody: Record<string, unknown> = {};
    setFetch(async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return okResponse({ content: [{ type: "text", text: "OK" }] });
    });

    const client = new ProviderClient("anthropic", { apiKey: "sk-ant-abc" }, opts);
    await client.complete(
      "claude-3-5-sonnet-20241022",
      [
        { role: "system", content: "Be concise" },
        { role: "user", content: "Hi" },
      ],
      defaultParams
    );

    expect(sentBody.system).toBe("Be concise");
    expect(sentBody.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hi" }] }]);
  });

  it("does not send OpenAI response_format to Anthropic", async () => {
    let sentBody: Record<string, unknown> = {};
    setFetch(async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return okResponse({ content: [{ type: "text", text: "{}" }] });
    });

    const client = new ProviderClient("anthropic", { apiKey: "sk-ant-abc" }, opts);
    await client.complete(
      "claude-3-5-sonnet-20241022",
      [{ role: "user", content: "Return JSON" }],
      { ...defaultParams, responseFormat: { type: "json_object" } }
    );

    expect(sentBody.response_format).toBeUndefined();
  });
});

describe("google provider", () => {
  it("builds correct request and parses response", async () => {
    let sentUrl = "";

    setFetch(async (url, _init) => {
      sentUrl = url.toString();
      return okResponse({
        candidates: [{ content: { parts: [{ text: "Hello from Gemini" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 },
      });
    });

    const client = new ProviderClient("google", { apiKey: "AIza-abc" }, opts);
    const result = await client.complete(
      "gemini-2.0-flash",
      [{ role: "user", content: "Hi" }],
      defaultParams
    );

    expect(sentUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
    );
    expect(result.content).toBe("Hello from Gemini");
    expect(result.usage?.promptTokens).toBe(8);
    expect(result.usage?.completionTokens).toBe(4);
    expect(result.usage?.totalTokens).toBe(12);
  });

  it("converts assistant role to model", async () => {
    let sentBody: unknown;
    setFetch(async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return okResponse({
        candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }],
      });
    });

    const client = new ProviderClient("google", { apiKey: "AIza-abc" }, opts);
    await client.complete(
      "gemini-2.0-flash",
      [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ],
      defaultParams
    );

    const contents = (sentBody as Record<string, unknown>).contents as Array<
      Record<string, unknown>
    >;
    expect(contents[0]?.role).toBe("user");
    expect(contents[1]?.role).toBe("model");
  });

  it("sends the API key in the Google API key header", async () => {
    let sentHeaders: Record<string, string> = {};
    setFetch(async (_url, init) => {
      sentHeaders = (init?.headers ?? {}) as Record<string, string>;
      return okResponse({
        candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }],
      });
    });

    const client = new ProviderClient("google", { apiKey: "AIza-abc" }, opts);
    await client.complete("gemini-2.0-flash", [{ role: "user", content: "Hi" }], defaultParams);

    expect(sentHeaders["Authorization"]).toBeUndefined();
    expect(sentHeaders["Content-Type"]).toBe("application/json");
    expect(sentHeaders["x-goog-api-key"]).toBe("AIza-abc");
  });

  it("uses systemInstruction and the streaming endpoint", async () => {
    let sentUrl = "";
    let sentBody: Record<string, unknown> = {};
    setFetch(async (url, init) => {
      sentUrl = url.toString();
      sentBody = JSON.parse(init?.body as string);
      return new Response(
        `data: {"candidates":[{"content":{"parts":[{"text":"OK"}]}}]}\n\ndata: {"candidates":[{"finishReason":"STOP"}]}\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } }
      );
    });

    const client = new ProviderClient("google", { apiKey: "AIza-abc" }, opts);
    const chunks: string[] = [];
    const stream = await client.stream(
      "gemini-2.0-flash",
      [
        { role: "system", content: "Be concise" },
        { role: "user", content: "Hi" },
      ],
      defaultParams
    );
    for await (const chunk of stream) chunks.push(chunk.content);

    expect(sentUrl).toEndWith("/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse");
    expect(sentBody.systemInstruction).toEqual({ parts: [{ text: "Be concise" }] });
    expect(sentBody.contents).toEqual([{ role: "user", parts: [{ text: "Hi" }] }]);
    expect(sentBody.stream).toBeUndefined();
  });
});

describe("provider dispatch", () => {
  it("uses openai handler for groq", async () => {
    let sentUrl = "";
    setFetch(async (url, _init) => {
      sentUrl = url.toString();
      return okResponse({ choices: [{ message: { content: "OK" } }] });
    });

    const client = new ProviderClient("groq", { apiKey: "gsk_abc" }, opts);
    await client.complete("llama-4-scout", [{ role: "user", content: "Hi" }], defaultParams);

    expect(sentUrl).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("uses openai handler for deepseek", async () => {
    let sentUrl = "";
    setFetch(async (url, _init) => {
      sentUrl = url.toString();
      return okResponse({ choices: [{ message: { content: "OK" } }] });
    });

    const client = new ProviderClient("deepseek", { apiKey: "sk-abc" }, opts);
    await client.complete("deepseek-chat", [{ role: "user", content: "Hi" }], defaultParams);

    expect(sentUrl).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("uses each provider's default OpenAI-compatible base URL", async () => {
    const expected: Record<string, string> = {
      openai: "https://api.openai.com/v1/chat/completions",
      together: "https://api.together.xyz/v1/chat/completions",
      nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
      openrouter: "https://openrouter.ai/api/v1/chat/completions",
      mistral: "https://api.mistral.ai/v1/chat/completions",
    };

    for (const [provider, expectedUrl] of Object.entries(expected)) {
      let sentUrl = "";
      setFetch(async (url) => {
        sentUrl = url.toString();
        return okResponse({ choices: [{ message: { content: "OK" } }] });
      });

      const client = new ProviderClient(provider, { apiKey: "key" }, opts);
      await client.complete("model", [{ role: "user", content: "Hi" }], defaultParams);
      expect(sentUrl).toBe(expectedUrl);
    }
  });

  it("works with sabi.complete for anthropic model", async () => {
    setFetch(async (_url, _init) => {
      return okResponse({
        content: [{ type: "text", text: "Hello from Claude" }],
        usage: { input_tokens: 5, output_tokens: 3 },
      });
    });

    const sabi = createWeysabi({ anthropic: { apiKey: "sk-ant-abc" } });
    const result = await sabi.complete({
      model: "anthropic/claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.content).toBe("Hello from Claude");
    expect(result.provider).toBe("anthropic");
  });
});
