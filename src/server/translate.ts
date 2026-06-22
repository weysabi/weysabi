import { z } from "zod";
import type { CompleteRequest, CompleteResponse, Message } from "../types";
import type { StreamChunk } from "../types";

const OpenAiMessageSchema = z.object({
  role: z.string(),
  content: z.string().nullable().optional(),
});

const OpenAiRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(OpenAiMessageSchema).optional(),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  sabi_fallbacks: z.array(z.string()).optional(),
  sabi_rag: z.boolean().optional(),
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
  if (parsed.max_tokens !== undefined) req.maxTokens = parsed.max_tokens;
  if (parsed.top_p !== undefined) req.topP = parsed.top_p;
  if (parsed.stop !== undefined) req.stop = parsed.stop;
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
  if (chunk.done) {
    return "data: [DONE]\n\n";
  }

  const id = `sabi-${crypto.randomUUID()}`;
  const data = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {
          content: chunk.content,
        },
        finish_reason: null as string | null,
      },
    ],
  };

  if (chunk.usage && data.choices[0]) {
    data.choices[0].finish_reason = "stop";
    return `data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`;
  }

  return `data: ${JSON.stringify(data)}\n\n`;
}
