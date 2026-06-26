import { describe, it, expect } from "bun:test";
import { translateRequest, translateResponse, translateStreamChunk } from "./translate";

describe("translateRequest", () => {
  it("converts OpenAI-style request to Weysabi CompleteRequest", () => {
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

  it("supports OpenAI token, response format, and stream usage fields", () => {
    const result = translateRequest({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Hi" }],
      max_completion_tokens: 250,
      response_format: { type: "json_object" },
      stream_options: { include_usage: true },
      n: 1,
    });

    expect(result.maxTokens).toBe(250);
    expect(result.responseFormat).toEqual({ type: "json_object" });
    expect(result.includeUsage).toBeTrue();
  });

  it("rejects unsupported OpenAI request behavior explicitly", () => {
    const base = {
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Hi" }],
    };

    expect(() => translateRequest({ ...base, n: 2 })).toThrow("Only n=1");
    expect(() => translateRequest({ ...base, tools: [] })).toThrow("tool calling");
    expect(() =>
      translateRequest({
        ...base,
        max_tokens: 100,
        max_completion_tokens: 200,
      })
    ).toThrow("must match");
  });

  it("rejects missing messages", () => {
    expect(() =>
      translateRequest({
        model: "groq/llama-4-scout",
      })
    ).toThrow();
  });
});

describe("translateResponse", () => {
  it("converts Weysabi CompleteResponse to OpenAI format", () => {
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

  it("includes usage in a done chunk and appends [DONE]", () => {
    const line = translateStreamChunk(
      {
        content: "",
        done: true,
        usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
      },
      "groq/llama-4-scout"
    );

    expect(line).toInclude("data: [DONE]");
    const parts = line.split("\n\n").filter(Boolean);
    const dataPart = parts[0]!;
    expect(dataPart).toStartWith("data: ");
    const parsed = JSON.parse(dataPart.slice(6));
    expect(parsed.choices).toEqual([]);
    expect(parsed.usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 10,
      total_tokens: 15,
    });
  });
});
