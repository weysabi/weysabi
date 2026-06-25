import type { StreamChunk } from "./types";

export function toResponse(stream: AsyncIterable<StreamChunk>): Response {
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const data = JSON.stringify(chunk) + "\n";
        controller.enqueue(new TextEncoder().encode(data));
        if (chunk.done) break;
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
