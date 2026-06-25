import type { StreamChunk } from "./types";

export async function pipe(
  stream: AsyncIterable<StreamChunk>,
  reply: {
    hijack(): void;
    raw: {
      writeHead(statusCode: number, headers: Record<string, string>): void;
      write(chunk: string): void;
      end(): void;
    };
  }
): Promise<void> {
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    for await (const chunk of stream) {
      reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
      if (chunk.done) break;
    }
  } finally {
    reply.raw.end();
  }
}
