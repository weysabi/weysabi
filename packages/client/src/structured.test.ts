import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import { createWeysabi } from "./index";
import { SchemaValidationError } from "./errors";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

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

describe("structured output", () => {
  it("returns parsed data matching the schema", async () => {
    setFetch(async () =>
      okResponse({
        choices: [{ message: { content: '{"name":"Alice","age":30}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
    );

    const sabi = createWeysabi({ groq: { apiKey: "key" } });
    const result = await sabi.complete({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Get user info" }],
      schema: z.object({ name: z.string(), age: z.number() }),
    });

    expect(result.parsed).toEqual({ name: "Alice", age: 30 });
    expect(result.content).toBe('{"name":"Alice","age":30}');
  });

  it("retries on invalid JSON and succeeds", async () => {
    let callCount = 0;
    setFetch(async () => {
      callCount++;
      const body =
        callCount === 1
          ? { choices: [{ message: { content: "not json" } }] }
          : { choices: [{ message: { content: '{"name":"Bob","age":25}' } }] };
      return okResponse(body);
    });

    const sabi = createWeysabi({ groq: { apiKey: "key" } });
    const result = await sabi.complete({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Get user" }],
      schema: z.object({ name: z.string(), age: z.number() }),
      schemaMaxRetries: 1,
    });

    expect(result.parsed).toEqual({ name: "Bob", age: 25 });
    expect(callCount).toBe(2);
  });

  it("retries on schema mismatch and succeeds", async () => {
    let callCount = 0;
    setFetch(async () => {
      callCount++;
      const body =
        callCount === 1
          ? { choices: [{ message: { content: '{"name":"Charlie"}' } }] }
          : {
              choices: [{ message: { content: '{"name":"Charlie","age":35}' } }],
            };
      return okResponse(body);
    });

    const sabi = createWeysabi({ groq: { apiKey: "key" } });
    const result = await sabi.complete({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Get user" }],
      schema: z.object({ name: z.string(), age: z.number() }),
      schemaMaxRetries: 1,
    });

    expect(result.parsed).toEqual({ name: "Charlie", age: 35 });
    expect(callCount).toBe(2);
  });

  it("throws SchemaValidationError after exhausting retries", async () => {
    setFetch(async () =>
      okResponse({
        choices: [{ message: { content: "bad json" } }],
      })
    );

    const sabi = createWeysabi({ groq: { apiKey: "key" } });
    const promise = sabi.complete({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "Get user" }],
      schema: z.object({ name: z.string() }),
      schemaMaxRetries: 0,
    });

    await expect(promise).rejects.toThrow(SchemaValidationError);
  });

  it("passes response_format: json_object to provider when schema is given", async () => {
    let sentBody: unknown;
    setFetch(async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return okResponse({
        choices: [{ message: { content: '{"ok":true}' } }],
      });
    });

    const sabi = createWeysabi({ groq: { apiKey: "key" } });
    await sabi.complete({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "hi" }],
      schema: z.object({ ok: z.boolean() }),
    });

    expect((sentBody as Record<string, unknown>)?.response_format).toEqual({
      type: "json_object",
    });
  });

  it("does not pass response_format when no schema", async () => {
    let sentBody: unknown;
    setFetch(async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return okResponse({
        choices: [{ message: { content: "Hello" } }],
      });
    });

    const sabi = createWeysabi({ groq: { apiKey: "key" } });
    await sabi.complete({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "hi" }],
    });

    expect((sentBody as Record<string, unknown>)?.response_format).toBeUndefined();
  });

  it("sends system message when schema is provided", async () => {
    let sentBody: unknown;
    setFetch(async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return okResponse({
        choices: [{ message: { content: '{"ok":true}' } }],
      });
    });

    const sabi = createWeysabi({ groq: { apiKey: "key" } });
    await sabi.complete({
      model: "groq/llama-4-scout",
      messages: [{ role: "user", content: "hi" }],
      schema: z.object({ ok: z.boolean() }),
    });

    const messages = (sentBody as Record<string, unknown>)?.messages as Array<
      Record<string, string>
    >;
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("JSON");
  });
});
