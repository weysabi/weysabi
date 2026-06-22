import { ConversationMemory } from "./memory";
import type { ChatAdapter } from "./adapters/adapter";

export interface ChatSDKOptions {
  adapter: ChatAdapter;
  memory?: ConversationMemory;
  maxHistoryTokens?: number;
}

export interface ChatSDKChatOptions {
  message: string;
  model: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  maxHistoryTokens?: number;
}

export interface ChatSDKResponse {
  content: string;
  sessionId: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
  historyTruncated: boolean;
}

export interface ChatSDKChunk {
  content: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  done: boolean;
}

export class ChatSDK {
  private adapter: ChatAdapter;
  private memory: ConversationMemory;

  constructor(opts: ChatSDKOptions) {
    this.adapter = opts.adapter;
    this.memory =
      opts.memory ?? new ConversationMemory({ maxHistoryTokens: opts.maxHistoryTokens });
  }

  async chat(sessionId: string, opts: ChatSDKChatOptions): Promise<ChatSDKResponse> {
    const ctx = await this.memory.prepare(sessionId, {
      message: opts.message,
      system: opts.system,
      maxHistoryTokens: opts.maxHistoryTokens,
    });

    const start = performance.now();
    const response = await this.adapter.complete({
      messages: ctx.messages,
      system: ctx.system,
      model: opts.model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
    });
    const latencyMs = performance.now() - start;

    await this.memory.record(sessionId, {
      userMessage: { content: opts.message },
      assistantMessage: { content: response.content },
      model: opts.model,
      usage: response.usage,
    });

    return {
      content: response.content,
      sessionId,
      model: opts.model,
      usage: response.usage,
      latencyMs,
      historyTruncated: ctx.historyTruncated,
    };
  }

  async *stream(sessionId: string, opts: ChatSDKChatOptions): AsyncIterable<ChatSDKChunk> {
    const ctx = await this.memory.prepare(sessionId, {
      message: opts.message,
      system: opts.system,
      maxHistoryTokens: opts.maxHistoryTokens,
    });

    if (!this.adapter.stream) {
      const response = await this.adapter.complete({
        messages: ctx.messages,
        system: ctx.system,
        model: opts.model,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      });
      await this.memory.record(sessionId, {
        userMessage: { content: opts.message },
        assistantMessage: { content: response.content },
        model: opts.model,
        usage: response.usage,
      });

      yield { content: response.content, usage: response.usage, done: true };
      return;
    }

    const fullContent: string[] = [];
    let finalUsage: ChatSDKResponse["usage"] | undefined;

    for await (const chunk of this.adapter.stream({
      messages: ctx.messages,
      system: ctx.system,
      model: opts.model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
    })) {
      if (chunk.content) {
        fullContent.push(chunk.content);
      }
      if (chunk.usage) {
        finalUsage = chunk.usage;
      }

      yield { content: chunk.content, usage: chunk.usage, done: chunk.done };

      if (chunk.done) {
        await this.memory.record(sessionId, {
          userMessage: { content: opts.message },
          assistantMessage: { content: fullContent.join("") },
          model: opts.model,
          usage: finalUsage,
        });
        return;
      }
    }
  }
}
