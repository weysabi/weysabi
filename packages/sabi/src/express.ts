import type { StreamChunk } from "./types";

interface ExpressResponse {
  writeHead(statusCode: number, headers: Record<string, string>): void;
  write(chunk: string): void;
  end(): void;
}

export async function pipe(
  stream: AsyncIterable<StreamChunk>,
  res: ExpressResponse
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    for await (const chunk of stream) {
      res.write(JSON.stringify(chunk) + "\n");
      if (chunk.done) break;
    }
  } finally {
    res.end();
  }
}
