import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWeysabi } from "./index";
import {
  AllModelsFailedError,
  PromptNotFoundError,
  MissingPromptInputError,
  WeysabiError,
} from "./errors";

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
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
  setFetch(async () => okResponse({ choices: [{ message: { content: "" } }] }));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Weysabi", () => {
  describe("createWeysabi", () => {
    it("creates an instance without throwing", () => {
      const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
      expect(sabi).toBeInstanceOf(Object);
      expect(sabi.complete).toBeFunction();
    });

    it("throws on empty apiKey", () => {
      expect(() => createWeysabi({ groq: { apiKey: "" } })).toThrow();
    });

    it("accepts custom baseUrl", () => {
      const sabi = createWeysabi({
        custom: { apiKey: "key", baseUrl: "https://custom.example.com/v1" },
      });
      expect(sabi).toBeTruthy();
    });
  });

  describe("prompt management", () => {
    it("registers and retrieves a structured prompt", () => {
      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      sabi.prompts.register({
        id: "classifier",
        messages: [
          { role: "system", content: "You are a classifier" },
          { role: "user", content: "Classify: {text}" },
        ],
        model: "groq/llama-4-scout",
      });
      const prompt = sabi.prompts.get("classifier");
      expect(prompt).toBeDefined();
      expect(prompt!.id).toBe("classifier");
      expect(prompt!.model).toBe("groq/llama-4-scout");
    });

    it("returns undefined for unknown prompt", () => {
      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      expect(sabi.prompts.get("nonexistent")).toBeUndefined();
    });

    it("lists registered prompts", () => {
      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      sabi.prompts.register({
        id: "a",
        messages: [{ role: "user", content: "A" }],
      });
      sabi.prompts.register({
        id: "b",
        messages: [{ role: "user", content: "B" }],
      });
      const list = sabi.prompts.list();
      expect(list).toHaveLength(2);
      expect(list.map((p) => p.id)).toEqual(["a", "b"]);
    });

    it("removes a prompt", () => {
      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      sabi.prompts.register({
        id: "test",
        messages: [{ role: "user", content: "test" }],
      });
      expect(sabi.prompts.has("test")).toBeTrue();
      sabi.prompts.remove("test");
      expect(sabi.prompts.has("test")).toBeFalse();
    });

    it("renders a structured prompt with variables", () => {
      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      sabi.prompts.register({
        id: "greeter",
        messages: [
          { role: "system", content: "You help {user}" },
          { role: "user", content: "Say {word}" },
        ],
      });
      const messages = sabi.prompts.render("greeter", { user: "Ben", word: "hello" });
      expect(messages).toEqual([
        { role: "system", content: "You help Ben" },
        { role: "user", content: "Say hello" },
      ]);
    });

    it("throws PromptNotFoundError for unknown prompt render", () => {
      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      expect(() => sabi.prompts.render("missing", { a: "1" })).toThrow(PromptNotFoundError);
    });

    it("throws MissingPromptInputError for missing input", () => {
      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      sabi.prompts.register({
        id: "test",
        messages: [{ role: "user", content: "{a} {b}" }],
      });
      expect(() => sabi.prompts.render("test", { a: "1" })).toThrow(MissingPromptInputError);
    });

    it("runs a prompt through the pipeline", async () => {
      setFetch(async () =>
        okResponse({
          choices: [{ message: { content: "It's a refund request" } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        })
      );

      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      sabi.prompts.register({
        id: "classifier",
        messages: [
          { role: "system", content: "You classify tickets" },
          { role: "user", content: "Classify: {text}" },
        ],
        model: "groq/llama-4-scout",
      });

      const result = await sabi.prompts.run("classifier", { text: "I want a refund" });
      expect(result.content).toBe("It's a refund request");
      expect(result.model).toBe("groq/llama-4-scout");
    });

    it("run overrides model from definition", async () => {
      setFetch(async () =>
        okResponse({
          choices: [{ message: { content: "Hello" } }],
        })
      );

      const sabi = createWeysabi({
        groq: { apiKey: "key" },
        nvidia: { apiKey: "key2" },
      });
      sabi.prompts.register({
        id: "test",
        messages: [{ role: "user", content: "Say {word}" }],
        model: "groq/llama-4-scout",
      });

      const result = await sabi.prompts.run(
        "test",
        { word: "hi" },
        { model: "nvidia/llama-3.1-8b-instruct" }
      );
      expect(result.provider).toBe("nvidia");
    });

    it("run throws with no model set", async () => {
      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      sabi.prompts.register({
        id: "nope",
        messages: [{ role: "user", content: "hi" }],
      });

      await expect(sabi.prompts.run("nope", {})).rejects.toThrow(/no default model/i);
    });

    it("run throws for unknown prompt", async () => {
      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      await expect(sabi.prompts.run("nonexistent", {})).rejects.toThrow(PromptNotFoundError);
    });

    it("supports initial prompt definitions in options", () => {
      const sabi = createWeysabi(
        { groq: { apiKey: "key" } },
        {
          promptDefinitions: [
            {
              id: "builtin",
              messages: [{ role: "user", content: "Built-in prompt" }],
              model: "groq/llama-4-scout",
            },
          ],
        }
      );
      const prompt = sabi.prompts.get("builtin");
      expect(prompt).toBeDefined();
      expect(prompt!.id).toBe("builtin");
    });

    it("clear removes all prompts", () => {
      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      sabi.prompts.register({ id: "a", messages: [{ role: "user", content: "A" }] });
      sabi.prompts.clear();
      expect(sabi.prompts.get("a")).toBeUndefined();
    });
  });

  describe("complete", () => {
    it("returns content from the provider", async () => {
      setFetch(async () =>
        okResponse({
          choices: [{ message: { content: "Hello!" } }],
          usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
        })
      );

      const sabi = createWeysabi({ groq: { apiKey: "gsk_abc" } });
      const result = await sabi.complete({
        model: "groq/llama-3.1-8b-instant",
        messages: [{ role: "user", content: "Say hello" }],
      });

      expect(result.content).toBe("Hello!");
      expect(result.provider).toBe("groq");
      expect(result.model).toBe("groq/llama-3.1-8b-instant");
      expect(result.usage).toEqual({
        promptTokens: 5,
        completionTokens: 10,
        totalTokens: 15,
      });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("renders prompt template and sends as message", async () => {
      let sentBody: unknown;
      setFetch(async (_url, init) => {
        sentBody = JSON.parse(init?.body as string);
        return okResponse({ choices: [{ message: { content: "Oui" } }] });
      });

      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      sabi.prompts.register({
        id: "translate",
        messages: [{ role: "user", content: "Say {word} in French" }],
      });
      const result = await sabi.complete({
        model: "groq/llama-3.1-8b-instant",
        prompt: "translate",
        inputs: { word: "yes" },
      });

      expect(result.content).toBe("Oui");
      expect((sentBody as Record<string, unknown>)?.messages).toEqual([
        { role: "user", content: "Say yes in French" },
      ]);
    });

    it("falls back to next model on failure", async () => {
      let attempts = 0;
      setFetch(async () => {
        attempts++;
        if (attempts <= 1) return errorResponse(500);
        return okResponse({ choices: [{ message: { content: "OK" } }] });
      });

      const sabi = createWeysabi(
        {
          groq: { apiKey: "key" },
          nvidia: { apiKey: "key2" },
        },
        { retry: { maxRetries: 0 } }
      );

      const result = await sabi.complete({
        model: "groq/llama-3.1-8b-instant",
        messages: [{ role: "user", content: "hi" }],
        fallbacks: ["nvidia/llama-3.1-8b-instruct"],
      });

      expect(result.content).toBe("OK");
      expect(result.provider).toBe("nvidia");
    });

    it("skips unconfigured providers in fallback chain", async () => {
      setFetch(async () => okResponse({ choices: [{ message: { content: "Works" } }] }));

      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      const result = await sabi.complete({
        model: "groq/llama-3.1-8b-instant",
        messages: [{ role: "user", content: "hi" }],
        fallbacks: ["openai/gpt-4o-mini", "groq/llama-4-scout"],
      });

      expect(result.content).toBe("Works");
      expect(result.provider).toBe("groq");
    });

    it("throws AllModelsFailedError when all fail", async () => {
      setFetch(async () => errorResponse(503));

      const sabi = createWeysabi({ groq: { apiKey: "key" } });

      await expect(
        sabi.complete({
          model: "groq/llama-3.1-8b-instant",
          messages: [{ role: "user", content: "hi" }],
        })
      ).rejects.toThrow(AllModelsFailedError);
    });

    it("throws on missing messages and no prompt", async () => {
      const sabi = createWeysabi({ groq: { apiKey: "key" } });

      await expect(
        sabi.complete({
          model: "groq/llama-3.1-8b-instant",
        })
      ).rejects.toThrow(WeysabiError);
    });

    it("passes temperature, maxTokens, topP, stop to API", async () => {
      let sentBody: unknown;
      setFetch(async (_url, init) => {
        sentBody = JSON.parse(init?.body as string);
        return okResponse({ choices: [{ message: { content: "ok" } }] });
      });

      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      await sabi.complete({
        model: "groq/llama-3.1-8b-instant",
        messages: [{ role: "user", content: "hi" }],
        temperature: 0.3,
        maxTokens: 100,
        topP: 0.9,
        stop: ["END"],
      });

      const body = sentBody as Record<string, unknown>;
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(100);
      expect(body.top_p).toBe(0.9);
      expect(body.stop).toEqual(["END"]);
    });

    it("times out and throws", async () => {
      setFetch(async (_url, init) => {
        const signal = (init as RequestInit)?.signal;
        return new Promise((_resolve, reject) => {
          if (signal) {
            signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError"))
            );
          }
        });
      });

      const sabi = createWeysabi({ groq: { apiKey: "key" } }, { timeout: 100 });

      await expect(
        sabi.complete({
          model: "groq/llama-3.1-8b-instant",
          messages: [{ role: "user", content: "hi" }],
        })
      ).rejects.toThrow();
    });

    it("circuit breaker trips and then recovers", async () => {
      setFetch(async () => errorResponse(503));

      const sabi = createWeysabi(
        { groq: { apiKey: "key" } },
        {
          circuitBreaker: { threshold: 3, cooldownMs: 1000, windowMs: 10_000 },
          retry: { maxRetries: 0 },
        }
      );

      for (let i = 0; i < 3; i++) {
        await expect(
          sabi.complete({
            model: "groq/llama-3.1-8b-instant",
            messages: [{ role: "user", content: "hi" }],
          })
        ).rejects.toThrow();
      }

      await expect(
        sabi.complete({
          model: "groq/llama-3.1-8b-instant",
          messages: [{ role: "user", content: "hi" }],
        })
      ).rejects.toThrow("Circuit breaker open");

      await new Promise((r) => setTimeout(r, 1100));

      setFetch(async () => okResponse({ choices: [{ message: { content: "Recovered" } }] }));

      const result = await sabi.complete({
        model: "groq/llama-3.1-8b-instant",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(result.content).toBe("Recovered");
    });
  });

  describe("parseModel validation", () => {
    it("validates model format via complete", async () => {
      setFetch(async () => okResponse({ choices: [{ message: { content: "ok" } }] }));

      const sabi = createWeysabi({ groq: { apiKey: "key" } });
      await expect(
        sabi.complete({
          model: "invalid-format",
          messages: [{ role: "user", content: "hi" }],
        })
      ).rejects.toThrow(/expected "provider\/model"/i);
    });
  });
});
