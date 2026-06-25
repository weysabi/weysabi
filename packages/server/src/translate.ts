import { z } from "zod";
import type { CompleteRequest, CompleteResponse, Message } from "@weysabi/sabi";
import type { StreamChunk } from "@weysabi/sabi";

const OpenAiMessageSchema = z.object({
  role: z.string(),
  content: z.string().nullable().optional(),
});

const OpenAiRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(OpenAiMessageSchema).min(1),
    stream: z.boolean().optional(),
    temperature: z.number().optional(),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    top_p: z.number().min(0).max(1).optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    response_format: z.record(z.string(), z.unknown()).optional(),
    stream_options: z
      .object({
        include_usage: z.boolean().optional(),
      })
      .optional(),
    n: z.number().int().positive().optional(),
    tools: z.unknown().optional(),
    tool_choice: z.unknown().optional(),
    sabi_fallbacks: z.array(z.string()).optional(),
    sabi_rag: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.max_tokens !== undefined &&
      value.max_completion_tokens !== undefined &&
      value.max_tokens !== value.max_completion_tokens
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["max_completion_tokens"],
        message: "max_tokens and max_completion_tokens must match when both are provided",
      });
    }
    if (value.n !== undefined && value.n !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["n"],
        message: "Only n=1 is supported",
      });
    }
    if (value.tools !== undefined || value.tool_choice !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["tools"],
        message: "HTTP tool calling is not supported; use @weysabi/sabi directly",
      });
    }
  });

function normalizeMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is Message => m && typeof m === "object" && "role" in m);
}

export function translateRequest(body: Record<string, unknown>): CompleteRequest {
  const parsed = OpenAiRequestSchema.parse(body);

  const req: CompleteRequest = {
    model: parsed.model,
    messages: normalizeMessages(parsed.messages),
  };

  if (parsed.temperature !== undefined) req.temperature = parsed.temperature;
  const maxTokens = parsed.max_completion_tokens ?? parsed.max_tokens;
  if (maxTokens !== undefined) req.maxTokens = maxTokens;
  if (parsed.top_p !== undefined) req.topP = parsed.top_p;
  if (parsed.stop !== undefined) req.stop = parsed.stop;
  if (parsed.response_format !== undefined) req.responseFormat = parsed.response_format;
  if (parsed.stream_options?.include_usage !== undefined) {
    req.includeUsage = parsed.stream_options.include_usage;
  }
  if (parsed.sabi_fallbacks) req.fallbacks = parsed.sabi_fallbacks;
  if (parsed.sabi_rag === true) req.rag = true;

  return req;
}

export interface OpenAiChoice {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: string | null;
}

export function translateResponse(
  response: CompleteResponse,
  model: string
): Record<string, unknown> {
  return {
    id: `sabi-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: response.content,
        },
        finish_reason: "stop",
      },
    ],
    usage: response.usage
      ? {
          prompt_tokens: response.usage.promptTokens,
          completion_tokens: response.usage.completionTokens,
          total_tokens: response.usage.totalTokens,
        }
      : undefined,
  };
}

export function translateStreamChunk(chunk: StreamChunk, model: string): string {
  if (chunk.done && !chunk.usage) {
    return "data: [DONE]\n\n";
  }

  const id = `sabi-${crypto.randomUUID()}`;
  const data: Record<string, unknown> = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: chunk.content
      ? [
          {
            index: 0,
            delta: {
              content: chunk.content,
            },
            finish_reason: chunk.done ? "stop" : null,
          },
        ]
      : [],
  };

  if (chunk.usage) {
    data.usage = {
      prompt_tokens: chunk.usage.promptTokens,
      completion_tokens: chunk.usage.completionTokens,
      total_tokens: chunk.usage.totalTokens,
    };
  }

  const event = `data: ${JSON.stringify(data)}\n\n`;
  return chunk.done ? `${event}data: [DONE]\n\n` : event;
}
