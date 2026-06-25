import type {
  ProviderConfig,
  ProviderCallResult,
  StreamChunk,
  CircuitBreakerState,
  ResolvedWeysabiOptions,
  HandlerMessage,
} from "./types";
import { ProviderRequestError, CircuitBreakerOpenError } from "./errors";
import { createModuleLogger } from "./logger";
import type { Catalog } from "@joinremba/catalog";
import { tryParseJSON } from "./utils";
import type { ProviderHandler, ToolDefInfo } from "./providers/handler";
import { openaiHandler } from "./providers/openai";
import { anthropicHandler } from "./providers/anthropic";
import { googleHandler } from "./providers/google";
import { mistralHandler } from "./providers/mistral";
import { ollamaHandler } from "./providers/ollama";

function noop(): void {}

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
  mistral: "https://api.mistral.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
  together: "https://api.together.xyz/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434",
};

function getDefaultBaseUrl(name: string): string {
  return DEFAULT_BASE_URLS[name] ?? "https://api.openai.com/v1";
}

function getHandler(name: string): ProviderHandler {
  if (name === "anthropic") return anthropicHandler;
  if (name === "google") return googleHandler;
  if (name === "mistral") return mistralHandler;
  if (name === "ollama") return ollamaHandler;
  return openaiHandler;
}

export class ProviderClient {
  public readonly name: string;
  public readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly handler: ProviderHandler;
  private cbState: CircuitBreakerState = {
    failures: [],
    tripped: false,
    trippedAt: 0,
  };
  private readonly opts: ResolvedWeysabiOptions;
  private readonly log: Catalog;
  private readonly configTimeout?: number;
  private readonly configRetry?: ProviderConfig["retry"];

  constructor(name: string, config: ProviderConfig, opts: ResolvedWeysabiOptions) {
    this.name = name;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? getDefaultBaseUrl(name);
    this.handler = getHandler(name);
    this.opts = opts;
    this.log = createModuleLogger(`providers.${name}`);
    this.configTimeout = config.timeout;
    this.configRetry = config.retry;
  }

  private get timeout(): number {
    return this.configTimeout ?? this.opts.timeout;
  }

  private get retryConfig(): { maxRetries: number; statusCodes: number[]; backoffMs: number } {
    return {
      maxRetries: this.configRetry?.maxRetries ?? this.opts.retry.maxRetries,
      statusCodes: this.configRetry?.statusCodes ?? this.opts.retry.statusCodes,
      backoffMs: this.configRetry?.backoffMs ?? this.opts.retry.backoffMs,
    };
  }

  async complete(
    modelId: string,
    messages: HandlerMessage[],
    params: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      stop?: string | string[];
      timeout: number;
      responseFormat?: Record<string, unknown>;
      tools?: ToolDefInfo[];
      toolChoice?: string;
    }
  ): Promise<ProviderCallResult> {
    this.checkCircuitBreaker();
    const hooks = this.opts.telemetry;

    const { maxRetries, statusCodes, backoffMs } = this.retryConfig;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = backoffMs * Math.pow(2, attempt - 1);
        this.log.warn({
          message: `Retrying ${this.name}/${modelId} after ${backoff}ms`,
          model: modelId,
          attempt,
          backoffMs: backoff,
        });
        await this.sleep(backoff);
      }

      const attemptStart = performance.now();
      hooks?.onAttempt?.({
        model: `${this.name}/${modelId}`,
        provider: this.name,
        attempt,
        timestamp: Date.now(),
      });

      try {
        const result = await this.executeRequest(modelId, messages, params);
        const attemptLatency = performance.now() - attemptStart;
        this.onSuccess();
        if (attempt > 0) {
          this.log.info({
            message: `Retry succeeded for ${this.name}/${modelId}`,
            model: modelId,
            attempt,
          });
        }
        hooks?.onSuccess?.({
          model: `${this.name}/${modelId}`,
          provider: this.name,
          latencyMs: attemptLatency,
          usage: result.usage,
          attempt,
        });
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.log.error({
          message: `Request failed for ${this.name}/${modelId}`,
          model: modelId,
          attempt,
          error: lastError.message,
        });

        const isLastAttempt = attempt === maxRetries;
        let willRetry = true;

        if (err instanceof ProviderRequestError) {
          const shouldRetry = statusCodes.includes(err.statusCode ?? 0);
          if (!shouldRetry || isLastAttempt) {
            willRetry = false;
            this.onFailure();
            hooks?.onFailure?.({
              model: `${this.name}/${modelId}`,
              provider: this.name,
              error: lastError.message,
              attempt,
              timestamp: Date.now(),
              willRetry: false,
            });
            throw lastError;
          }
        } else {
          if (isLastAttempt) {
            willRetry = false;
            this.onFailure();
            hooks?.onFailure?.({
              model: `${this.name}/${modelId}`,
              provider: this.name,
              error: lastError.message,
              attempt,
              timestamp: Date.now(),
              willRetry: false,
            });
            throw lastError;
          }
        }

        hooks?.onFailure?.({
          model: `${this.name}/${modelId}`,
          provider: this.name,
          error: lastError.message,
          attempt,
          timestamp: Date.now(),
          willRetry,
        });
      }
    }

    this.onFailure();
    throw lastError ?? new Error("Unknown error");
  }

  private async executeRequest(
    modelId: string,
    messages: HandlerMessage[],
    params: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      stop?: string | string[];
      timeout: number;
      responseFormat?: Record<string, unknown>;
      tools?: ToolDefInfo[];
      toolChoice?: string;
    }
  ): Promise<ProviderCallResult> {
    const url = this.handler.buildUrl(this.baseUrl, modelId, false);
    const headers = this.handler.buildHeaders(this.apiKey);
    const body = this.handler.buildBody(modelId, messages, {
      ...params,
      stream: false,
    });

    const controller = new AbortController();
    const timeout = this.timeout;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(noop);
        throw new ProviderRequestError(
          this.name,
          modelId,
          response.status,
          text || response.statusText
        );
      }

      const data = await response.json();

      try {
        return this.handler.parseResponse(data);
      } catch (parseErr) {
        throw new ProviderRequestError(
          this.name,
          modelId,
          undefined,
          parseErr instanceof Error ? parseErr.message : "Failed to parse response"
        );
      }
    } catch (err) {
      if (err instanceof ProviderRequestError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ProviderRequestError(
          this.name,
          modelId,
          undefined,
          `Request timed out after ${timeout}ms`
        );
      }
      throw new ProviderRequestError(
        this.name,
        modelId,
        undefined,
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private checkCircuitBreaker(): void {
    if (!this.cbState.tripped) return;

    const elapsed = Date.now() - this.cbState.trippedAt;
    if (elapsed >= this.opts.circuitBreaker.cooldownMs) {
      this.cbState.tripped = false;
      this.cbState.failures = [];
      this.log.info({ message: `Circuit breaker recovered for ${this.name}` });
      return;
    }

    const remaining = this.opts.circuitBreaker.cooldownMs - elapsed;
    this.log.warn({
      message: `Circuit breaker open for ${this.name}, retry in ${remaining}ms`,
      cooldownRemainingMs: remaining,
    });
    throw new CircuitBreakerOpenError(this.name, remaining);
  }

  private onSuccess(): void {
    if (this.cbState.failures.length > 0) {
      this.log.info({ message: `Request succeeded, resetting circuit breaker for ${this.name}` });
    }
    this.cbState.failures = [];
    this.cbState.tripped = false;
  }

  private onFailure(): void {
    const now = Date.now();
    const windowStart = now - this.opts.circuitBreaker.windowMs;
    this.cbState.failures = this.cbState.failures.filter((ts) => ts > windowStart);
    this.cbState.failures.push(now);

    if (this.cbState.failures.length >= this.opts.circuitBreaker.threshold) {
      this.cbState.tripped = true;
      this.cbState.trippedAt = now;
      this.log.error({
        message: `Circuit breaker tripped for ${this.name}`,
        failures: this.cbState.failures.length,
        threshold: this.opts.circuitBreaker.threshold,
        windowMs: this.opts.circuitBreaker.windowMs,
      });
    }
  }

  async stream(
    modelId: string,
    messages: HandlerMessage[],
    params: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      stop?: string | string[];
      timeout: number;
      signal?: AbortSignal;
      responseFormat?: Record<string, unknown>;
      includeUsage?: boolean;
    }
  ): Promise<AsyncIterable<StreamChunk>> {
    this.checkCircuitBreaker();
    const hooks = this.opts.telemetry;

    hooks?.onAttempt?.({
      model: `${this.name}/${modelId}`,
      provider: this.name,
      attempt: 0,
      timestamp: Date.now(),
    });

    const url = this.handler.buildUrl(this.baseUrl, modelId, true);
    const headers = this.handler.buildHeaders(this.apiKey);
    const body = this.handler.buildBody(modelId, messages, {
      ...params,
      stream: true,
    });

    const timeout = this.timeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const signal = params.signal
      ? AbortSignal.any([controller.signal, params.signal])
      : controller.signal;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(noop);
        this.onFailure();
        clearTimeout(timeoutId);
        hooks?.onFailure?.({
          model: `${this.name}/${modelId}`,
          provider: this.name,
          error: text || response.statusText,
          attempt: 0,
          timestamp: Date.now(),
          willRetry: false,
        });
        throw new ProviderRequestError(
          this.name,
          modelId,
          response.status,
          text || response.statusText
        );
      }

      const rawReader = response.body?.getReader();
      if (!rawReader) {
        this.onFailure();
        clearTimeout(timeoutId);
        hooks?.onFailure?.({
          model: `${this.name}/${modelId}`,
          provider: this.name,
          error: "Response body is not readable",
          attempt: 0,
          timestamp: Date.now(),
          willRetry: false,
        });
        throw new ProviderRequestError(
          this.name,
          modelId,
          undefined,
          "Response body is not readable"
        );
      }

      this.onSuccess();
      hooks?.onSuccess?.({
        model: `${this.name}/${modelId}`,
        provider: this.name,
        latencyMs: 0,
        attempt: 0,
      });
      return this.parseSSEStream(
        modelId,
        rawReader as ReadableStreamDefaultReader<Uint8Array>,
        timeoutId
      );
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof ProviderRequestError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        if (params.signal?.aborted) {
          throw new ProviderRequestError(this.name, modelId, undefined, "Stream aborted");
        }
        hooks?.onFailure?.({
          model: `${this.name}/${modelId}`,
          provider: this.name,
          error: `Stream timed out after ${timeout}ms`,
          attempt: 0,
          timestamp: Date.now(),
          willRetry: false,
        });
        throw new ProviderRequestError(
          this.name,
          modelId,
          undefined,
          `Stream timed out after ${timeout}ms`
        );
      }
      hooks?.onFailure?.({
        model: `${this.name}/${modelId}`,
        provider: this.name,
        error: err instanceof Error ? err.message : String(err),
        attempt: 0,
        timestamp: Date.now(),
        willRetry: false,
      });
      throw new ProviderRequestError(
        this.name,
        modelId,
        undefined,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  private async *parseSSEStream(
    modelId: string,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutId: ReturnType<typeof setTimeout>
  ): AsyncIterable<StreamChunk> {
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const raw = trimmed.slice(6);
          if (raw === "[DONE]") return;

          const parsed = tryParseJSON(raw);
          if (parsed === null) continue;

          const usage = this.handler.parseStreamUsage(parsed);
          if (usage) {
            yield { content: "", usage, done: true };
            return;
          }

          const chunk = this.handler.parseStreamChunk(parsed);
          if (chunk === null) continue;

          yield { content: chunk.content, done: chunk.done };
          if (chunk.done) return;
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
