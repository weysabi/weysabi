import type {
  ProviderConfig,
  SabiOptions,
  ResolvedSabiOptions,
  CompleteRequest,
  CompleteResponse,
  StreamRequest,
  StreamChunk,
  Message,
  ToolDefinition,
  HandlerMessage,
  SabiPlugin,
} from "./types";
import { cacheKey } from "./types";
import {
  ProviderConfigSchema,
  SabiOptionsSchema,
  CompleteRequestSchema,
  StreamRequestSchema,
  resolveSabiOptions,
} from "./types";
import { z } from "zod";
import { PromptRegistry } from "./prompts";
import { ProviderClient } from "./providers";
import { parseModel, tryParseJSON } from "./utils";
import { createModuleLogger } from "./logger";
import { estimateCost } from "./pricing";
import type { Catalog } from "@joinremba/catalog";
import type { ToolDefInfo } from "./providers/handler";
import { RagEngine } from "./rag/engine";
import {
  SabiError,
  AllModelsFailedError,
  ProviderNotConfiguredError,
  CircuitBreakerOpenError,
  PromptNotFoundError,
  MissingPromptInputError,
  ProviderRequestError,
  SchemaValidationError,
  ToolExecutionError,
  MaxToolCallsExceededError,
} from "./errors";

export { readStream } from "./stream";

export type {
  ProviderConfig,
  SabiOptions,
  CompleteRequest,
  CompleteResponse,
  StreamRequest,
  StreamChunk,
  Message,
  ResolvedSabiOptions,
  ToolDefinition,
  ToolCall,
  ToolChoice,
  HandlerMessage,
} from "./types";

export type {
  TelemetryHooks,
  AttemptMetadata,
  SuccessMetadata,
  FailureMetadata,
  FallbackMetadata,
} from "./types";

export type { SabiPlugin, CacheAdapter } from "./types";
export { cacheKey } from "./types";
export { InMemoryCache, RedisCache } from "./cache";
export type { RedisLikeClient } from "./cache";
export { RagEngine } from "./rag/engine";

export {
  SabiError,
  AllModelsFailedError,
  ProviderNotConfiguredError,
  CircuitBreakerOpenError,
  PromptNotFoundError,
  MissingPromptInputError,
  ProviderRequestError,
  SchemaValidationError,
  ToolExecutionError,
  MaxToolCallsExceededError,
};

export { estimateCost, addPricing } from "./pricing";
export type { ModelPricing } from "./pricing";

export { zodToJsonSchema } from "./utils";

export interface Sabi {
  prompt(name: string, template: string): void;
  prompt(name: string): string | undefined;
  render(name: string, inputs: Record<string, string>): string;
  complete<T = unknown>(request: CompleteRequest): Promise<CompleteResponse<T>>;
  stream(request: StreamRequest): AsyncIterable<StreamChunk>;
  use(plugin: SabiPlugin): void;
  rag: RagEngine;
}

class SabiImpl implements Sabi {
  private providers: Map<string, ProviderClient>;
  private prompts: PromptRegistry;
  private opts: ResolvedSabiOptions;
  private readonly log: Catalog;
  private plugins: SabiPlugin[] = [];
  rag: RagEngine;

  constructor(providers: Record<string, ProviderConfig>, options: SabiOptions = {}) {
    SabiOptionsSchema.parse(options);
    this.opts = resolveSabiOptions(options);
    this.log = createModuleLogger("sabi");
    this.providers = new Map();
    this.rag = new RagEngine(options.rag as Record<string, unknown> | undefined);

    for (const [name, config] of Object.entries(providers)) {
      const validated = ProviderConfigSchema.parse(config);
      this.providers.set(name, new ProviderClient(name, validated, this.opts));
    }
    this.prompts = new PromptRegistry(options.prompts);

    this.setupRagProvider(providers);
  }

  private setupRagProvider(providers: Record<string, ProviderConfig>): void {
    const embeddingModel = this.rag["options"].embeddingModel;
    const [providerName] = embeddingModel.split("/");
    if (providerName && providers[providerName]) {
      this.rag.setProviders(
        { ...providers[providerName]!, provider: providerName },
        providers
      );
    } else {
      const first = Object.entries(providers)[0];
      if (first) {
        this.rag.setProviders(
          { ...first[1], provider: first[0] },
          providers
        );
      }
    }
  }

  use(plugin: SabiPlugin): void {
    this.plugins.push(plugin);
  }

  prompt(name: string, template: string): void;
  prompt(name: string): string | undefined;
  prompt(name: string, template?: string): string | undefined | void {
    if (template === undefined) {
      return this.prompts.get(name);
    }
    this.prompts.set(name, template);
  }

  render(name: string, inputs: Record<string, string>): string {
    return this.prompts.render(name, inputs);
  }

  async complete<T = unknown>(request: CompleteRequest): Promise<CompleteResponse<T>> {
    let currentRequest = request;
    for (const plugin of this.plugins) {
      if (plugin.onCompleteRequest) {
        currentRequest = await plugin.onCompleteRequest(currentRequest);
      }
    }

    const cache = this.opts.cache;
    if (cache) {
      const key = cacheKey(currentRequest);
      const cached = await cache.get(key);
      if (cached) {
        return cached as CompleteResponse<T>;
      }
    }

    try {
      let response = await this.runComplete<T>(currentRequest);
      for (const plugin of this.plugins) {
        if (plugin.onCompleteResponse) {
          response = (await plugin.onCompleteResponse(
            response,
            currentRequest
          )) as CompleteResponse<T>;
        }
      }
      if (cache) {
        const key = cacheKey(currentRequest);
        await cache.set(key, response);
      }
      return response;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const plugin of this.plugins) {
        plugin.onError?.(error, { request: currentRequest });
      }
      throw err;
    }
  }

  private async runComplete<T = unknown>(request: CompleteRequest): Promise<CompleteResponse<T>> {
    const parsed = CompleteRequestSchema.parse(request);
    const messages: HandlerMessage[] = this.resolveMessages(parsed);

    if (parsed.rag) {
      const queryText = messages.map((m) => ("content" in m ? m.content : "")).filter(Boolean).join("\n");
      if (queryText) {
        const results = await this.rag.query(queryText);
        if (results.length > 0) {
          const context = results.map((r) => r.content).join("\n\n---\n\n");
          const hasSystem = messages[0]?.role === "system";
          const systemMsg: HandlerMessage = {
            role: "system",
            content: `Use the following context to answer the user's question:\n\n${context}`,
          };
          if (hasSystem) {
            messages[0] = {
              role: "system",
              content: (messages[0] as { content: string }).content + "\n\n" + systemMsg.content,
            };
          } else {
            messages.unshift(systemMsg);
          }
        }
      }
    }

    const models = [parsed.model, ...(parsed.fallbacks ?? [])];
    const errors: { model: string; error: string }[] = [];
    const schema = parsed.schema as z.ZodType<T> | undefined;
    const maxRetries = parsed.schemaMaxRetries ?? 1;
    const hooks = this.opts.telemetry;

    const rawTools = parsed.tools as ToolDefinition[] | undefined;
    const tools: ToolDefInfo[] | undefined = rawTools?.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    const toolMap: Map<string, (args: unknown) => Promise<string> | string> | undefined = rawTools
      ? new Map(rawTools.map((t) => [t.name, t.execute]))
      : undefined;
    const maxToolCalls = parsed.maxToolCalls ?? 10;

    let systemMessage: Message | undefined;
    if (schema !== undefined) {
      systemMessage = {
        role: "system" as const,
        content:
          "You must respond with valid JSON matching the requested schema. No markdown, no explanation — only JSON.",
      };
    }

    for (const fullModel of models) {
      const { provider, modelId } = parseModel(fullModel);
      const client = this.providers.get(provider);
      if (client === undefined) {
        this.log.warn({
          message: `Provider "${provider}" is not configured, skipping fallback`,
          model: fullModel,
          configuredProviders: Array.from(this.providers.keys()),
        });
        errors.push({ model: fullModel, error: `Provider "${provider}" is not configured` });
        continue;
      }

      const modelMessages: HandlerMessage[] = systemMessage
        ? [systemMessage, ...messages]
        : [...messages];
      let toolCallCount = 0;
      let toolLoopDone = false;

      while (!toolLoopDone && toolCallCount <= maxToolCalls) {
        let didToolCall = false;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const start = performance.now();
            const result = await client.complete(modelId, modelMessages, {
              temperature: parsed.temperature,
              maxTokens: parsed.maxTokens,
              topP: parsed.topP,
              stop: parsed.stop,
              timeout: this.opts.timeout,
              responseFormat: schema !== undefined ? { type: "json_object" as const } : undefined,
              tools,
              toolChoice: parsed.toolChoice,
            });
            const latencyMs = performance.now() - start;
            const cost = estimateCost(modelId, result.usage, this.opts.pricing);

            if (result.tool_calls && result.tool_calls.length > 0 && toolMap) {
              if (toolCallCount >= maxToolCalls) {
                throw new MaxToolCallsExceededError(maxToolCalls);
              }

              modelMessages.push({
                role: "assistant",
                content: result.content,
                tool_calls: result.tool_calls,
              } as HandlerMessage);

              for (const tc of result.tool_calls) {
                const execute = toolMap.get(tc.name);
                if (!execute) {
                  modelMessages.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: `Error: Tool "${tc.name}" not found`,
                  } as HandlerMessage);
                  continue;
                }

                let output: string;
                try {
                  const args = tryParseJSON(tc.arguments);
                  output = await execute(args);
                } catch (execErr) {
                  output = execErr instanceof Error ? execErr.message : String(execErr);
                }
                modelMessages.push({
                  role: "tool",
                  tool_call_id: tc.id,
                  content: output,
                } as HandlerMessage);
              }

              toolCallCount++;
              didToolCall = true;
              break;
            }

            if (schema === undefined) {
              this.log.info({
                message: `Completed via ${provider}/${modelId}`,
                model: fullModel,
                provider,
                latencyMs,
                tokens: result.usage?.totalTokens,
              });
              return {
                content: result.content,
                model: fullModel,
                provider,
                usage: result.usage,
                latencyMs,
                estimatedCostUsd: cost,
              } as CompleteResponse<T>;
            }

            const raw = result.content;
            const parsedJson = tryParseJSON<T>(raw);

            if (parsedJson !== null) {
              try {
                const parsedData = schema.parse(parsedJson);
                this.log.info({
                  message: `Completed via ${provider}/${modelId}`,
                  model: fullModel,
                  provider,
                  latencyMs,
                  tokens: result.usage?.totalTokens,
                });
                return {
                  content: raw,
                  parsed: parsedData,
                  model: fullModel,
                  provider,
                  usage: result.usage,
                  latencyMs,
                  estimatedCostUsd: cost,
                } as CompleteResponse<T>;
              } catch (parseErr) {
                const validationError =
                  parseErr instanceof z.ZodError ? parseErr : new z.ZodError([]);
                if (attempt < maxRetries) {
                  const feedback = `Your previous response was not valid for the expected schema.\nErrors:\n${validationError.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n")}\n\nRespond with ONLY valid JSON matching the schema.`;
                  modelMessages.push({ role: "assistant" as const, content: raw });
                  modelMessages.push({ role: "user" as const, content: feedback });
                  continue;
                }
                throw new SchemaValidationError(raw, parseErr);
              }
            }

            if (attempt < maxRetries) {
              modelMessages.push({ role: "assistant" as const, content: raw });
              modelMessages.push({
                role: "user" as const,
                content: "Your response was not valid JSON. Respond with ONLY valid JSON.",
              });
              continue;
            }

            throw new SchemaValidationError(raw, new Error("Response was not valid JSON"));
          } catch (err) {
            if (err instanceof SchemaValidationError) throw err;
            if (err instanceof MaxToolCallsExceededError) throw err;
            const errorMessage = err instanceof Error ? err.message : String(err);
            const modelIndex = models.indexOf(fullModel);
            const remainingFallbacks = models.slice(modelIndex + 1).length;

            this.log.warn({
              message: `Failing over from ${fullModel}`,
              model: fullModel,
              error: errorMessage,
              remainingFallbacks,
            });

            const nextModel = models[modelIndex + 1];
            if (nextModel !== undefined) {
              hooks?.onFallback?.({
                from: fullModel,
                to: nextModel,
                error: errorMessage,
                remainingFallbacks,
              });
            }

            errors.push({ model: fullModel, error: errorMessage });
            toolLoopDone = true;
            break;
          }
        }

        if (!didToolCall) break;
      }
    }

    this.log.error({
      message: "All models failed",
      primaryModel: parsed.model,
      fallbacks: parsed.fallbacks ?? [],
      errors,
    });

    throw new AllModelsFailedError(parsed.model, parsed.fallbacks ?? [], errors);
  }

  async *stream(request: StreamRequest): AsyncIterable<StreamChunk> {
    let currentRequest = request;
    for (const plugin of this.plugins) {
      if (plugin.onStreamRequest) {
        currentRequest = await plugin.onStreamRequest(currentRequest);
      }
    }

    try {
      yield* this.runStream(currentRequest);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const plugin of this.plugins) {
        plugin.onError?.(error, { request: currentRequest });
      }
      throw err;
    }
  }

  private async *runStream(request: StreamRequest): AsyncIterable<StreamChunk> {
    const parsed = StreamRequestSchema.parse(request);
    if (parsed.tools && parsed.tools.length > 0) {
      throw new SabiError(
        "Tools are not supported in streaming mode. Use sabi.complete() instead."
      );
    }
    const messages = this.resolveMessages(parsed);
    const models = [parsed.model, ...(parsed.fallbacks ?? [])];
    const errors: { model: string; error: string }[] = [];
    const hooks = this.opts.telemetry;

    for (const fullModel of models) {
      const { provider, modelId } = parseModel(fullModel);
      const client = this.providers.get(provider);
      if (client === undefined) {
        this.log.warn({
          message: `Provider "${provider}" is not configured, skipping stream fallback`,
          model: fullModel,
        });
        errors.push({ model: fullModel, error: `Provider "${provider}" is not configured` });
        continue;
      }

      try {
        const streamIterable = await client.stream(modelId, messages, {
          temperature: parsed.temperature,
          maxTokens: parsed.maxTokens,
          topP: parsed.topP,
          stop: parsed.stop,
          timeout: this.opts.timeout,
        });

        this.log.info({
          message: `Stream started via ${provider}/${modelId}`,
          model: fullModel,
          provider,
        });

        for await (const chunk of streamIterable) {
          yield chunk;
          if (chunk.done) return;
        }
        return;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.log.warn({
          message: `Stream failover from ${fullModel}`,
          model: fullModel,
          error: errorMessage,
        });

        const modelIndex = models.indexOf(fullModel);
        const nextModel = models[modelIndex + 1];
        if (nextModel !== undefined) {
          hooks?.onFallback?.({
            from: fullModel,
            to: nextModel,
            error: errorMessage,
            remainingFallbacks: models.slice(modelIndex + 1).length,
          });
        }

        errors.push({ model: fullModel, error: errorMessage });
      }
    }

    this.log.error({
      message: "All models failed for stream",
      primaryModel: parsed.model,
      fallbacks: parsed.fallbacks ?? [],
      errors,
    });

    throw new AllModelsFailedError(parsed.model, parsed.fallbacks ?? [], errors);
  }

  private resolveMessages(req: CompleteRequest | StreamRequest): HandlerMessage[] {
    if (req.prompt !== undefined) {
      const content = this.prompts.render(req.prompt, req.inputs ?? {});
      return [{ role: "user", content }];
    }
    if (req.messages !== undefined && req.messages.length > 0) {
      return req.messages as HandlerMessage[];
    }
    throw new SabiError("Either messages or prompt must be provided");
  }
}

export function createSabi(providers: Record<string, ProviderConfig>, options?: SabiOptions): Sabi {
  return new SabiImpl(providers, options);
}

export default createSabi;
