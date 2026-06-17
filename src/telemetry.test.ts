import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createSabi, estimateCost } from "./index";
import type { TelemetryHooks } from "./types";

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

describe("telemetry hooks", () => {
  describe("onAttempt", () => {
    it("calls onAttempt before a completion", async () => {
      setFetch(async () =>
        okResponse({
          choices: [{ message: { content: "Hello" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      );

      const attempts: unknown[] = [];
      const hooks: TelemetryHooks = {
        onAttempt: (m) => attempts.push(m),
      };

      const sabi = createSabi({ groq: { apiKey: "key" } }, { telemetry: hooks });
      await sabi.complete({
        model: "groq/llama-3.1-8b-instant",
        messages: [{ role: "user", content: "hi" }],
      });

      expect(attempts.length).toBe(1);
      const attempt = attempts[0] as Record<string, unknown>;
      expect(attempt.model).toBe("groq/llama-3.1-8b-instant");
      expect(attempt.provider).toBe("groq");
      expect(attempt.attempt).toBe(0);
      expect(attempt.timestamp).toBeGreaterThan(0);
    });

    it("calls onAttempt for each retry", async () => {
      setFetch(async () => {
        return errorResponse(503);
      });

      const attempts: unknown[] = [];
      const hooks: TelemetryHooks = {
        onAttempt: (m) => attempts.push(m),
      };

      const sabi = createSabi(
        { groq: { apiKey: "key" } },
        { telemetry: hooks, retry: { maxRetries: 2 } }
      );

      await expect(
        sabi.complete({
          model: "groq/llama-3.1-8b-instant",
          messages: [{ role: "user", content: "hi" }],
        })
      ).rejects.toThrow();

      expect(attempts.length).toBe(3);
      expect((attempts[0] as Record<string, unknown>).attempt).toBe(0);
      expect((attempts[1] as Record<string, unknown>).attempt).toBe(1);
      expect((attempts[2] as Record<string, unknown>).attempt).toBe(2);
    });
  });

  describe("onSuccess", () => {
    it("calls onSuccess after a successful completion", async () => {
      setFetch(async () =>
        okResponse({
          choices: [{ message: { content: "Hello" } }],
          usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
        })
      );

      const successes: unknown[] = [];
      const hooks: TelemetryHooks = {
        onSuccess: (m) => successes.push(m),
      };

      const sabi = createSabi({ groq: { apiKey: "key" } }, { telemetry: hooks });
      await sabi.complete({
        model: "groq/llama-3.1-8b-instant",
        messages: [{ role: "user", content: "hi" }],
      });

      expect(successes.length).toBe(1);
      const s = successes[0] as Record<string, unknown>;
      expect(s.model).toBe("groq/llama-3.1-8b-instant");
      expect(s.provider).toBe("groq");
      expect(s.attempt).toBe(0);
    });

    it("includes usage in onSuccess metadata", async () => {
      setFetch(async () =>
        okResponse({
          choices: [{ message: { content: "Hello" } }],
          usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
        })
      );

      const successes: unknown[] = [];
      const hooks: TelemetryHooks = {
        onSuccess: (m) => successes.push(m),
      };

      const sabi = createSabi({ groq: { apiKey: "key" } }, { telemetry: hooks });
      await sabi.complete({
        model: "groq/llama-3.1-8b-instant",
        messages: [{ role: "user", content: "hi" }],
      });

      const s = successes[0] as Record<string, unknown>;
      const usage = s.usage as Record<string, unknown>;
      expect(usage.promptTokens).toBe(5);
      expect(usage.completionTokens).toBe(10);
      expect(usage.totalTokens).toBe(15);
    });
  });

  describe("onFailure", () => {
    it("calls onFailure when a request fails", async () => {
      setFetch(async () => errorResponse(500));

      const failures: unknown[] = [];
      const hooks: TelemetryHooks = {
        onFailure: (m) => failures.push(m),
      };

      const sabi = createSabi(
        { groq: { apiKey: "key" } },
        { telemetry: hooks, retry: { maxRetries: 0 } }
      );

      await expect(
        sabi.complete({
          model: "groq/llama-3.1-8b-instant",
          messages: [{ role: "user", content: "hi" }],
        })
      ).rejects.toThrow();

      expect(failures.length).toBe(1);
      const f = failures[0] as Record<string, unknown>;
      expect(f.model).toBe("groq/llama-3.1-8b-instant");
      expect(f.provider).toBe("groq");
      expect(f.attempt).toBe(0);
      expect(f.willRetry).toBe(false);
    });

    it("calls onFailure with willRetry=true when retries remain", async () => {
      setFetch(async () => errorResponse(503));

      const failures: unknown[] = [];
      const hooks: TelemetryHooks = {
        onFailure: (m) => failures.push(m),
      };

      const sabi = createSabi(
        { groq: { apiKey: "key" } },
        { telemetry: hooks, retry: { maxRetries: 2 } }
      );

      await expect(
        sabi.complete({
          model: "groq/llama-3.1-8b-instant",
          messages: [{ role: "user", content: "hi" }],
        })
      ).rejects.toThrow();

      expect(failures.length).toBe(3);
      expect((failures[0] as Record<string, unknown>).willRetry).toBe(true);
      expect((failures[2] as Record<string, unknown>).willRetry).toBe(false);
    });
  });

  describe("onFallback", () => {
    it("calls onFallback when primary model fails", async () => {
      let callCount = 0;
      setFetch(async () => {
        callCount++;
        if (callCount === 1) return errorResponse(500);
        return okResponse({ choices: [{ message: { content: "OK" } }] });
      });

      const fallbacks: unknown[] = [];
      const hooks: TelemetryHooks = {
        onFallback: (m) => fallbacks.push(m),
      };

      const sabi = createSabi(
        {
          groq: { apiKey: "key" },
          openai: { apiKey: "key2" },
        },
        { telemetry: hooks, retry: { maxRetries: 0 } }
      );

      await sabi.complete({
        model: "groq/llama-3.1-8b-instant",
        messages: [{ role: "user", content: "hi" }],
        fallbacks: ["openai/gpt-4o-mini"],
      });

      expect(fallbacks.length).toBe(1);
      const f = fallbacks[0] as Record<string, unknown>;
      expect(f.from).toBe("groq/llama-3.1-8b-instant");
      expect(f.to).toBe("openai/gpt-4o-mini");
      expect(f.remainingFallbacks).toBe(1);
    });

    it("calls onFallback for each failover in the chain", async () => {
      setFetch(async () => {
        return errorResponse(500);
      });

      const fallbacks: unknown[] = [];
      const hooks: TelemetryHooks = {
        onFallback: (m) => fallbacks.push(m),
      };

      const sabi = createSabi(
        {
          groq: { apiKey: "key" },
          nvidia: { apiKey: "key2" },
          openai: { apiKey: "key3" },
        },
        { telemetry: hooks, retry: { maxRetries: 0 } }
      );

      await expect(
        sabi.complete({
          model: "groq/llama-3.1-8b-instant",
          messages: [{ role: "user", content: "hi" }],
          fallbacks: ["nvidia/llama-3.1-8b-instruct", "openai/gpt-4o-mini"],
        })
      ).rejects.toThrow();

      expect(fallbacks.length).toBe(2);
      expect((fallbacks[0] as Record<string, unknown>).from).toBe("groq/llama-3.1-8b-instant");
      expect((fallbacks[0] as Record<string, unknown>).to).toBe("nvidia/llama-3.1-8b-instruct");
      expect((fallbacks[1] as Record<string, unknown>).from).toBe("nvidia/llama-3.1-8b-instruct");
      expect((fallbacks[1] as Record<string, unknown>).to).toBe("openai/gpt-4o-mini");
    });
  });

  describe("estimatedCostUsd", () => {
    it("returns estimatedCostUsd in response for known models", async () => {
      setFetch(async () =>
        okResponse({
          choices: [{ message: { content: "Hello" } }],
          usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
        })
      );

      const sabi = createSabi({ openai: { apiKey: "key" } });
      const result = await sabi.complete({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.estimatedCostUsd).toBeDefined();
      expect(result.estimatedCostUsd).toBeGreaterThan(0);
    });

    it("returns undefined estimatedCostUsd for unknown models", async () => {
      setFetch(async () =>
        okResponse({
          choices: [{ message: { content: "Hello" } }],
          usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
        })
      );

      const sabi = createSabi({ groq: { apiKey: "key" } });
      const result = await sabi.complete({
        model: "groq/unknown-model",
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.estimatedCostUsd).toBeUndefined();
    });
  });

  describe("estimateCost utility", () => {
    it("calculates cost for known model", () => {
      const cost = estimateCost("gpt-4o-mini", {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
      });
      expect(cost).toBe(0.75); // $0.15 input + $0.60 output
    });

    it("returns undefined for unknown model", () => {
      const cost = estimateCost("unknown/model", {
        promptTokens: 100,
        completionTokens: 100,
      });
      expect(cost).toBeUndefined();
    });

    it("returns undefined when usage is missing", () => {
      const cost = estimateCost("gpt-4o-mini", undefined);
      expect(cost).toBeUndefined();
    });
  });
});
