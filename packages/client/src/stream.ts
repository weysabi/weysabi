import type { StreamChunk } from "./types";
import { tryParseJSON } from "./utils";

export async function* readStream(body: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
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

        const data = trimmed.slice(6);
        if (data === "[DONE]") return;

        const parsed = tryParseJSON<{
          choices?: Array<{
            delta?: { content?: string | null };
            finish_reason?: string | null;
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        }>(data);

        if (parsed === null) continue;

        if (parsed.usage) {
          yield {
            content: "",
            usage: {
              promptTokens: parsed.usage.prompt_tokens ?? 0,
              completionTokens: parsed.usage.completion_tokens ?? 0,
              totalTokens: parsed.usage.total_tokens ?? 0,
            },
            done: true,
          };
          return;
        }

        const choice = parsed.choices?.[0];
        if (!choice) continue;

        const content = choice.delta?.content ?? "";
        const isDone = choice.finish_reason != null;
        yield { content, done: isDone };

        if (isDone) return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
