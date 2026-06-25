import { describe, expect, it } from "bun:test";
import { toResponse } from "./sse";
import { readStream } from "./stream";
import type { StreamChunk } from "./types";

async function* chunks(): AsyncIterable<StreamChunk> {
  yield { content: "Hello", done: false };
  yield {
    content: "",
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    done: true,
  };
}

describe("SSE adapters", () => {
  it("frames stream chunks as valid SSE events", async () => {
    const response = toResponse(chunks());
    const body = await response.text();

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(body).toBe(
      'data: {"content":"Hello","done":false}\n\n' +
        'data: {"content":"","usage":{"promptTokens":1,"completionTokens":2,"totalTokens":3},"done":true}\n\n'
    );
  });

  it("readStream consumes Weysabi SSE chunk events", async () => {
    const response = toResponse(chunks());
    const received: StreamChunk[] = [];

    for await (const chunk of readStream(response.body!)) {
      received.push(chunk);
    }

    expect(received).toEqual([
      { content: "Hello", done: false },
      {
        content: "",
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        done: true,
      },
    ]);
  });
});
