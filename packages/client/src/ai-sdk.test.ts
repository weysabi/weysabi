import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type {
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3CallOptions,
  LanguageModelV3ToolResultOutput,
} from "@ai-sdk/provider";
import { createWeysabiProvider, WeysabiLanguageModel } from "./ai-sdk";
import { createWeysabi } from "./index";
import { WeysabiError } from "./errors";

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

describe("createWeysabiProvider", () => {
  it("returns a ProviderV3 with specificationVersion v3", () => {
    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const provider = createWeysabiProvider(sabi);

    expect(provider.specificationVersion).toBe("v3");
    expect(provider.languageModel).toBeFunction();
  });

  it("languageModel returns a WeysabiLanguageModel", () => {
    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const provider = createWeysabiProvider(sabi);
    const model = provider.languageModel("groq/llama-3.1-8b-instant");

    expect(model).toBeInstanceOf(WeysabiLanguageModel);
    expect(model.provider).toBe("groq");
    expect(model.modelId).toBe("groq/llama-3.1-8b-instant");
    expect(model.specificationVersion).toBe("v3");
  });

  it("throws for invalid model format", () => {
    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const provider = createWeysabiProvider(sabi);

    expect(() => provider.languageModel("invalid")).toThrow(/expected "provider\/model"/i);
  });
});

describe("WeysabiLanguageModel.doGenerate", () => {
  it("returns text content", async () => {
    setFetch(async () =>
      okResponse({
        choices: [{ message: { content: "Hello from Weysabi!" } }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      })
    );

    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const model = new WeysabiLanguageModel(sabi, "groq/llama-3.1-8b-instant");

    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "text", text: "Say hello" }] },
    ];

    const result = await model.doGenerate({ prompt });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Hello from Weysabi!",
    });
    expect(result.finishReason).toEqual({ unified: "stop", raw: "stop" });
    expect(result.usage.inputTokens.total).toBe(5);
    expect(result.usage.outputTokens.total).toBe(10);
    expect(result.warnings).toEqual([]);
  });

  it("passes generation parameters to Weysabi", async () => {
    let sentBody: unknown;
    setFetch(async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return okResponse({ choices: [{ message: { content: "ok" } }] });
    });

    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const model = new WeysabiLanguageModel(sabi, "groq/llama-3.1-8b-instant");

    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];

    const options: LanguageModelV3CallOptions = {
      prompt,
      maxOutputTokens: 200,
      temperature: 0.5,
      topP: 0.9,
      stopSequences: ["END"],
    };

    await model.doGenerate(options);

    const body = sentBody as Record<string, unknown>;
    expect(body.max_tokens).toBe(200);
    expect(body.temperature).toBe(0.5);
    expect(body.top_p).toBe(0.9);
    expect(body.stop).toEqual(["END"]);
  });

  it("converts system + user messages", async () => {
    let sentBody: unknown;
    setFetch(async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return okResponse({ choices: [{ message: { content: "response" } }] });
    });

    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const model = new WeysabiLanguageModel(sabi, "groq/llama-3.1-8b-instant");

    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "Be concise." },
      { role: "user", content: [{ type: "text", text: "Say hi" }] },
    ];

    await model.doGenerate({ prompt });

    const body = sentBody as Record<string, unknown>;
    expect(body.messages).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "Say hi" },
    ]);
  });

  it("converts assistant messages with tool calls and tool results", async () => {
    let sentBody: unknown;
    setFetch(async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return okResponse({ choices: [{ message: { content: "final" } }] });
    });

    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const model = new WeysabiLanguageModel(sabi, "groq/llama-3.1-8b-instant");

    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "text", text: "What's the weather?" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check." },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "get_weather",
            input: { city: "Lagos" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "get_weather",
            output: "Sunny, 32°C" as unknown as LanguageModelV3ToolResultOutput,
          },
        ],
      },
    ];

    await model.doGenerate({ prompt });

    const body = sentBody as Record<string, unknown>;
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: "user", content: "What's the weather?" });

    const assistantMsg = messages[1]!;
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("Let me check.");
    const toolCalls = assistantMsg.tool_calls as Array<Record<string, unknown>>;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.id).toBe("call_1");

    const toolMsg = messages[2]!;
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.tool_call_id).toBe("call_1");
    expect(toolMsg.content).toBe("Sunny, 32°C");
  });

  it("throws when tools are provided", async () => {
    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const model = new WeysabiLanguageModel(sabi, "groq/llama-3.1-8b-instant");

    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];

    await expect(
      model.doGenerate({
        prompt,
        tools: [{ type: "function", name: "test", inputSchema: {} }],
      })
    ).rejects.toThrow(WeysabiError);
  });

  it("returns JSON text from responseFormat", async () => {
    setFetch(async () =>
      okResponse({
        choices: [
          {
            message: { content: '{"name":"Alice"}' },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      })
    );

    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const model = new WeysabiLanguageModel(sabi, "groq/llama-3.1-8b-instant");

    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "text", text: "Generate a name" }] },
    ];

    const result = await model.doGenerate({
      prompt,
      responseFormat: {
        type: "json",
        schema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    });

    expect((result.content[0] as { type: "text"; text: string }).text).toBe('{"name":"Alice"}');
  });
});

describe("WeysabiLanguageModel.doStream", () => {
  it("streams text parts", async () => {
    setFetch(async () =>
      sseResponse(
        `data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}`,
        `data: {"choices":[{"delta":{"content":" world"},"index":0}]}`,
        `data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":10,"total_tokens":15}}`,
        "data: [DONE]"
      )
    );

    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const model = new WeysabiLanguageModel(sabi, "groq/llama-3.1-8b-instant");

    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "text", text: "Say hi" }] },
    ];

    const result = await model.doStream({ prompt });
    const parts: LanguageModelV3StreamPart[] = [];
    const reader = result.stream.getReader();
    let streamDone = false;

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) {
        streamDone = true;
        break;
      }
      parts.push(value);
    }

    const types = parts.map((p) => p.type);
    expect(types).toContain("stream-start");
    expect(types).toContain("text-start");
    expect(types).toContain("text-delta");
    expect(types).toContain("text-end");
    expect(types).toContain("finish");

    const textDelta = parts.find((p) => p.type === "text-delta") as
      | { type: "text-delta"; delta: string }
      | undefined;
    expect(textDelta?.delta).toBe("Hello");

    const finish = parts.find((p) => p.type === "finish") as
      | {
          type: "finish";
          usage: { inputTokens: { total: number }; outputTokens: { total: number } };
        }
      | undefined;
    expect(finish?.usage.inputTokens.total).toBe(5);
    expect(finish?.usage.outputTokens.total).toBe(10);
  });

  it("accumulates multiple text deltas", async () => {
    setFetch(async () =>
      sseResponse(
        `data: {"choices":[{"delta":{"content":"Hel"},"index":0}]}`,
        `data: {"choices":[{"delta":{"content":"lo "},"index":0}]}`,
        `data: {"choices":[{"delta":{"content":"world"},"index":0}]}`,
        `data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}`,
        "data: [DONE]"
      )
    );

    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const model = new WeysabiLanguageModel(sabi, "groq/llama-3.1-8b-instant");

    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "text", text: "Say hi" }] },
    ];

    const result = await model.doStream({ prompt });
    const deltas: string[] = [];
    const reader = result.stream.getReader();
    let streamDone = false;

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) {
        streamDone = true;
        break;
      }
      if (value.type === "text-delta") {
        deltas.push(value.delta);
      }
    }

    expect(deltas).toEqual(["Hel", "lo ", "world"]);
  });

  it("throws when tools are provided", async () => {
    const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
    const model = new WeysabiLanguageModel(sabi, "groq/llama-3.1-8b-instant");

    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];

    await expect(
      model.doStream({
        prompt,
        tools: [{ type: "function", name: "test", inputSchema: {} }],
      })
    ).rejects.toThrow(WeysabiError);
  });

  it("converts messages to Weysabi format for stream", async () => {
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
    const model = new WeysabiLanguageModel(sabi, "groq/llama-3.1-8b-instant");

    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "You are a bot." },
      { role: "user", content: [{ type: "text", text: "Say OK" }] },
    ];

    const result = await model.doStream({ prompt });
    const reader = result.stream.getReader();
    let streamDone = false;
    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done || value.type === "finish") {
        streamDone = true;
        break;
      }
    }

    const body = sentBody as Record<string, unknown>;
    expect(body.messages).toEqual([
      { role: "system", content: "You are a bot." },
      { role: "user", content: "Say OK" },
    ]);
  });
});
