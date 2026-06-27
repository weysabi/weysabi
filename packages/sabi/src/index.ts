import type {
  ProviderConfig,
  WeysabiOptions,
  ResolvedWeysabiOptions,
  CompleteRequest,
  CompleteResponse,
  StreamRequest,
  StreamChunk,
  Message,
  ToolDefinition,
  HandlerMessage,
  Plugin,
  TelemetryHooks,
  ProviderCallResult,
} from "./types";
import { cacheKey } from "./types";
import {
  ProviderConfigSchema,
  WeysabiOptionsSchema,
  CompleteRequestSchema,
  StreamRequestSchema,
  resolveWeysabiOptions,
} from "./types";
import { z } from "zod";
import { ProviderClient } from "./providers";
import { createWeysabiPrompts } from "./prompts";
import type { Prompts, PromptDefinition } from "./prompts";
import { parseModel, tryParseJSON } from "./utils";
import { createModuleLogger } from "./logger";
import { estimateCost } from "./pricing";
import type { Catalog } from "@joinremba/catalog";
import type { ToolDefInfo } from "./providers/handler";
import type { GuardrailOptions, GuardrailMatch } from "./guardrails/types";
import { GuardrailError } from "./errors";
import { RagEngine } from "./rag/engine";
import {
  WeysabiError,
  AllModelsFailedError,
  ProviderNotConfiguredError,
  CircuitBreakerOpenError,
  PromptNotFoundError,
  MissingPromptInputError,
  ProviderRequestError,
  SchemaValidationError,
  MaxToolCallsExceededError,
} from "./errors";

export { readStream } from "./stream";

export type {
  ProviderConfig,
  WeysabiOptions,
  CompleteRequest,
  CompleteResponse,
  StreamRequest,
  StreamChunk,
  Message,
  ResolvedWeysabiOptions,
  ToolDefinition,
  ToolCall,
  ToolChoice,
  HandlerMessage,
  ToolCallMessage,
  ToolResultMessage,
} from "./types";

export type {
  TelemetryHooks,
  AttemptMetadata,
  SuccessMetadata,
  FailureMetadata,
  FallbackMetadata,
} from "./types";

export type { Plugin, CacheAdapter } from "./types";
export type { GuardrailOptions } from "./guardrails/types";
export { cacheKey } from "./types";
export { InMemoryCache, RedisCache } from "./cache";
export type { RedisLikeClient } from "./cache";
export { createSabiClient, createSabiProjectClient, SabiApiError } from "./client";
export type {
  AppendMessageInput,
  Conversation,
  ConversationEvent,
  ConversationMessage,
  ConversationQuery,
  ConversationStatus,
  ConversationUsage,
  CreateApiKeyInput,
  CreateConversationInput,
  CreateDocumentInput,
  CreatedProjectApiKey,
  CreateProjectInput,
  CreatePromptInput,
  CreatePromptVersionInput,
  CreateRunInput,
  DocumentQuery,
  ExecutePromptInput,
  ManagedDocument,
  ManagedPrompt,
  MessageQuery,
  Page,
  PageOptions,
  Project,
  ProjectApiKey,
  ProjectScope,
  ProjectSettings,
  PromptMessage,
  PromptMessageRole,
  PromptVersion,
  Run,
  RunAttempt,
  RunQuery,
  RunStats,
  RunStatsQuery,
  RunStatus,
  SabiClient,
  SabiClientOptions,
  SabiProjectClient,
  SabiProjectClientOptions,
  SabiRequestOptions,
  SendConversationMessageInput,
  SendConversationMessageResult,
  UpdateApiKeyInput,
  UpdateConversationInput,
  UpdateMessageInput,
  UpdateProjectInput,
  UpdatePromptInput,
  UpdateRunInput,
} from "./client";
export { RagEngine } from "./rag/engine";
export {
  ConversationMemory,
  SqliteSessionStore,
  PgSessionStore,
  ChatSDK,
  OpenAIAdapter,
  AnthropicAdapter,
} from "./chat";
export type { StoreInterface, ChatAdapter, AdapterRequest, AdapterResponse } from "./chat";

export {
  WeysabiError,
  AllModelsFailedError,
  ProviderNotConfiguredError,
  CircuitBreakerOpenError,
  PromptNotFoundError,
  MissingPromptInputError,
  ProviderRequestError,
  SchemaValidationError,
  MaxToolCallsExceededError,
};

export { estimateCost, addPricing } from "./pricing";
export type { ModelPricing } from "./pricing";

export { zodToJsonSchema } from "./utils";
export type { Prompts, PromptDefinition } from "./prompts";
export { Prompt } from "./prompts";

import type { Weysabi } from "./weysabi";
export type { Weysabi } from "./weysabi";

class WeysabiImpl implements Weysabi {
  private providers: Map<string, ProviderClient>;
  prompts: Prompts;
  private opts: ResolvedWeysabiOptions;
  private readonly log: Catalog;
  private plugins: Plugin[] = [];
  rag: RagEngine;

  constructor(providers: Record<string, ProviderConfig>, options: WeysabiOptions = {}) {
    WeysabiOptionsSchema.parse(options);
    this.opts = resolveWeysabiOptions(options);
    this.log = createModuleLogger("sabi");
    this.providers = new Map();
    this.rag = new RagEngine(options.rag as Record<string, unknown> | undefined);

    for (const [name, config] of Object.entries(providers)) {
      const validated = ProviderConfigSchema.parse(config);
      this.providers.set(name, new ProviderClient(name, validated, this.opts));
    }

    this.prompts = createWeysabiPrompts({
      initialDefinitions: options.promptDefinitions as PromptDefinition[] | undefined,
      complete: <T>(req: CompleteRequest) => this.complete<T>(req),
    });

    this.setupRagProvider(providers);
  }

  private setupRagProvider(providers: Record<string, ProviderConfig>): void {
    const embeddingModel = this.rag["options"].embeddingModel;
    const [providerName] = embeddingModel.split("/");
    if (providerName && providers[providerName]) {
      this.rag.setProviders({ ...providers[providerName]!, provider: providerName }, providers);
    } else {
      const first = Object.entries(providers)[0];
      if (first) {
        this.rag.setProviders({ ...first[1], provider: first[0] }, providers);
      }
    }
  }

  use(plugin: Plugin): void {
    this.plugins.push(plugin);
  }

  guardrail(name: string, options: GuardrailOptions): void {
    const plugin: Plugin = {
      name: `guardrail.${name}`,

      onCompleteRequest(request: CompleteRequest): CompleteRequest {
        if (options.scope === "output") return request;
        const text = (request.messages ?? []).map((m) => m.content ?? "").join("\n");
        const result = options.validate(text);
        const passed = typeof result === "boolean" ? result : result.passed;
        if (passed) return request;

        const message =
          typeof result === "object" && result.message
            ? result.message
            : `Guardrail "${name}" blocked input`;
        const match: GuardrailMatch = {
          category: "custom",
          subcategory: name,
          action: "block",
          message,
        };
        options.onViolation?.(match);
        throw new GuardrailError(match);
      },

      onCompleteResponse(response: CompleteResponse): CompleteResponse {
        if (options.scope === "input") return response;
        const result = options.validate(response.content);
        const passed = typeof result === "boolean" ? result : result.passed;
        if (passed) return response;

        const message =
          typeof result === "object" && result.message
            ? result.message
            : `Guardrail "${name}" blocked output`;
        const match: GuardrailMatch = {
          category: "custom",
          subcategory: name,
          action: "block",
          message,
        };
        options.onViolation?.(match);
        throw new GuardrailError(match);
      },
    };

    this.use(plugin);
  }

  close(): void {
    this.rag.close();
  }

  async complete<T = unknown>(request: CompleteRequest): Promise<CompleteResponse<T>> {
    let currentRequest: CompleteRequest = this.materializePrompt(
      this.normalizeModels(request) as CompleteRequest
    );
    for (const plugin of this.plugins) {
      if (plugin.onCompleteRequest) {
        currentRequest = (await plugin.onCompleteRequest(currentRequest)) as CompleteRequest;
      }
    }

    const cache = this.opts.cache;
    if (cache) {
      try {
        const key = cacheKey(currentRequest);
        const cached = await cache.get(key);
        if (cached) {
          let response = cached as CompleteResponse<T>;
          for (const plugin of this.plugins) {
            if (plugin.onCompleteResponse) {
              response = (await plugin.onCompleteResponse(
                response,
                currentRequest
              )) as CompleteResponse<T>;
            }
          }
          return response;
        }
      } catch {
        this.log.warn({ message: "Cache read failed, proceeding without cache" });
      }
    }

    try {
      let response = await this.runComplete<T>(currentRequest);
      if (cache) {
        try {
          const key = cacheKey(currentRequest);
          await cache.set(key, response);
        } catch {
          this.log.warn({ message: "Cache write failed, response delivered uncached" });
        }
      }
      for (const plugin of this.plugins) {
        if (plugin.onCompleteResponse) {
          response = (await plugin.onCompleteResponse(
            response,
            currentRequest
          )) as CompleteResponse<T>;
        }
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
    const messages = await this.injectRagContext(this.resolveMessages(parsed), parsed);
    const models: string[] = [parsed.model as string, ...(parsed.fallbacks ?? [])];
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

    const wantsJson =
      schema !== undefined ||
      parsed.responseFormat?.type === "json_object" ||
      parsed.responseFormat?.type === "json_schema";
    const systemMessage: Message | undefined = wantsJson
      ? {
          role: "system",
          content:
            "You must respond with valid JSON matching the requested schema. No markdown, no explanation — only JSON.",
        }
      : undefined;

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

      const result = await this.attemptModel<T>({
        fullModel,
        modelMessages,
        models,
        parsed,
        client,
        provider,
        modelId,
        schema,
        maxRetries,
        maxToolCalls,
        toolMap,
        tools,
        errors,
        hooks,
      });

      if (result) return result;
    }

    this.log.error({
      message: "All models failed",
      primaryModel: parsed.model,
      fallbacks: parsed.fallbacks ?? [],
      errors,
    });

    throw new AllModelsFailedError(parsed.model as string, parsed.fallbacks ?? [], errors);
  }

  private async injectRagContext(
    messages: HandlerMessage[],
    parsed: CompleteRequest
  ): Promise<HandlerMessage[]> {
    if (!parsed.rag) return messages;

    const queryText = messages
      .map((m) => ("content" in m ? m.content : ""))
      .filter(Boolean)
      .join("\n");
    if (!queryText) return messages;

    const results = await this.rag.query(queryText);
    if (results.length === 0) return messages;

    const context = results.map((r) => r.content).join("\n\n---\n\n");
    const hasSystem = messages[0]?.role === "system";
    const systemMsg: HandlerMessage = {
      role: "system",
      content: `Use the following context to answer the user's question:\n\n${context}`,
    };

    if (hasSystem) {
      messages[0] = {
        role: "system",
        content: `${(messages[0] as { content: string }).content}\n\n${systemMsg.content}`,
      };
    } else {
      messages.unshift(systemMsg);
    }

    return messages;
  }

  private async attemptModel<T>(params: {
    fullModel: string;
    modelMessages: HandlerMessage[];
    models: string[];
    parsed: CompleteRequest;
    client: ProviderClient;
    provider: string;
    modelId: string;
    schema: z.ZodType<T> | undefined;
    maxRetries: number;
    maxToolCalls: number;
    toolMap: Map<string, (args: unknown) => Promise<string> | string> | undefined;
    tools: ToolDefInfo[] | undefined;
    errors: { model: string; error: string }[];
    hooks: TelemetryHooks | undefined;
  }): Promise<CompleteResponse<T> | null> {
    const {
      fullModel,
      modelMessages,
      models,
      parsed,
      client,
      provider,
      modelId,
      schema,
      maxRetries,
      maxToolCalls,
      toolMap,
      tools,
      errors,
      hooks,
    } = params;

    let toolCallCount = 0;

    while (toolCallCount <= maxToolCalls) {
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
            responseFormat:
              schema !== undefined ? { type: "json_object" as const } : parsed.responseFormat,
            tools,
            toolChoice: parsed.toolChoice,
          });
          const latencyMs = performance.now() - start;
          const cost = estimateCost(modelId, result.usage, this.opts.pricing);

          if (result.tool_calls && result.tool_calls.length > 0 && toolMap) {
            didToolCall = await this.handleToolCallResult(
              result,
              modelMessages,
              toolMap,
              maxToolCalls,
              toolCallCount
            );
            toolCallCount++;
            break;
          }

          if (schema === undefined) {
            const response: CompleteResponse<T> = {
              content: result.content,
              model: fullModel,
              provider,
              usage: result.usage,
              latencyMs,
              estimatedCostUsd: cost,
            } as CompleteResponse<T>;

            this.log.info({
              message: `Completed via ${provider}/${modelId}`,
              model: fullModel,
              provider,
              latencyMs,
              tokens: result.usage?.totalTokens,
            });

            return response;
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
          return null;
        }
      }

      if (!didToolCall) break;
    }

    return null;
  }

  private async handleToolCallResult(
    result: ProviderCallResult,
    modelMessages: HandlerMessage[],
    toolMap: Map<string, (args: unknown) => Promise<string> | string>,
    maxToolCalls: number,
    toolCallCount: number
  ): Promise<boolean> {
    const tcs = result.tool_calls!;
    if (toolCallCount >= maxToolCalls) {
      throw new MaxToolCallsExceededError(maxToolCalls);
    }

    modelMessages.push({
      role: "assistant",
      content: result.content,
      tool_calls: tcs,
    } as HandlerMessage);

    for (const tc of tcs) {
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

    return true;
  }

  async *stream(request: StreamRequest): AsyncIterable<StreamChunk> {
    let currentRequest: StreamRequest = this.materializePrompt(
      this.normalizeModels(request) as StreamRequest
    );
    for (const plugin of this.plugins) {
      if (plugin.onStreamRequest) {
        currentRequest = (await plugin.onStreamRequest(currentRequest)) as StreamRequest;
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
    } finally {
      for (const plugin of this.plugins) {
        await plugin.onStreamEnd?.(currentRequest);
      }
    }
  }

  private async *runStream(request: StreamRequest): AsyncIterable<StreamChunk> {
    const parsed = StreamRequestSchema.parse(request);
    if (parsed.tools && parsed.tools.length > 0) {
      throw new WeysabiError(
        "Tools are not supported in streaming mode. Use sabi.complete() instead."
      );
    }
    const messages = this.resolveMessages(parsed);
    const models: string[] = [parsed.model as string, ...(parsed.fallbacks ?? [])];
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

      let emitted = false;
      try {
        const streamIterable = await client.stream(modelId, messages, {
          temperature: parsed.temperature,
          maxTokens: parsed.maxTokens,
          topP: parsed.topP,
          stop: parsed.stop,
          timeout: this.opts.timeout,
          signal: parsed.signal,
          responseFormat: parsed.responseFormat,
          includeUsage: parsed.includeUsage,
        });

        this.log.info({
          message: `Stream started via ${provider}/${modelId}`,
          model: fullModel,
          provider,
        });

        for await (const chunk of streamIterable) {
          emitted = true;
          yield chunk;
          if (chunk.done) return;
        }
        return;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (emitted) {
          this.log.error({
            message: `Stream interrupted after output from ${fullModel}`,
            model: fullModel,
            error: errorMessage,
          });
          throw new WeysabiError(
            `Stream interrupted after ${fullModel} emitted output; fallback was not attempted`,
            { cause: err }
          );
        }

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

    throw new AllModelsFailedError(parsed.model as string, parsed.fallbacks ?? [], errors);
  }

  private normalizeModels<Req extends CompleteRequest | StreamRequest>(
    request: Req
  ): Req & { model: string } {
    if (Array.isArray(request.model)) {
      const [primary, ...rest] = request.model;
      return {
        ...request,
        model: primary!,
        fallbacks: [...rest, ...(request.fallbacks ?? [])],
      } as Req & { model: string };
    }
    return request as Req & { model: string };
  }

  private materializePrompt<Req extends CompleteRequest | StreamRequest>(request: Req): Req {
    if (request.prompt === undefined) return request;
    return {
      ...request,
      messages: this.prompts.render(request.prompt, request.inputs ?? {}),
      prompt: undefined,
      inputs: undefined,
    } as Req;
  }

  private resolveMessages(req: CompleteRequest | StreamRequest): HandlerMessage[] {
    if (req.prompt !== undefined) {
      return this.prompts.render(req.prompt, req.inputs ?? {}) as HandlerMessage[];
    }
    if (req.messages !== undefined && req.messages.length > 0) {
      return req.messages as HandlerMessage[];
    }
    throw new WeysabiError("Either messages or prompt must be provided");
  }
}

export function createWeysabi(
  providers: Record<string, ProviderConfig>,
  options?: WeysabiOptions
): Weysabi {
  return new WeysabiImpl(providers, options);
}

export default createWeysabi;
