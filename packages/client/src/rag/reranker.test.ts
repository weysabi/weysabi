import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { identityReranker, createCohereReranker } from "./reranker";
import type { RagSearchResult } from "./types";

function makeResult(overrides: Partial<RagSearchResult> & { id: string }): RagSearchResult {
  return { content: "", filePath: "/test.txt", score: 0.5, ...overrides };
}

describe("identityReranker", () => {
  it("returns results unchanged", async () => {
    const results = [
      makeResult({ id: "1", score: 0.9, content: "foo" }),
      makeResult({ id: "2", score: 0.5, content: "bar" }),
    ];
    const output = await identityReranker("test query", results);
    expect(output).toEqual(results);
    expect(output).toBe(results);
  });

  it("handles empty results", async () => {
    const output = await identityReranker("test query", []);
    expect(output).toEqual([]);
  });
});

describe("createCohereReranker", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reranks results based on Cohere API response", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              { index: 1, relevance_score: 0.95 },
              { index: 0, relevance_score: 0.42 },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )) as unknown as typeof globalThis.fetch;

    const reranker = createCohereReranker({ apiKey: "test-key" });
    const results = [
      makeResult({ id: "a", content: "first doc", score: 0.8 }),
      makeResult({ id: "b", content: "second doc", score: 0.6 }),
    ];

    const output = await reranker("some query", results);

    expect(output).toHaveLength(2);
    expect(output[0]!.id).toBe("b");
    expect(output[0]!.score).toBe(0.95);
    expect(output[1]!.id).toBe("a");
    expect(output[1]!.score).toBe(0.42);
  });

  it("preserves other fields during rerank", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [{ index: 0, relevance_score: 0.88 }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )) as unknown as typeof globalThis.fetch;

    const reranker = createCohereReranker({ apiKey: "test-key" });
    const results = [makeResult({ id: "x", content: "hello", filePath: "/doc.txt", score: 0.3 })];

    const output = await reranker("query", results);
    expect(output[0]!.content).toBe("hello");
    expect(output[0]!.filePath).toBe("/doc.txt");
  });

  it("handles empty results", async () => {
    const reranker = createCohereReranker({ apiKey: "test-key" });
    const output = await reranker("query", []);
    expect(output).toEqual([]);
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("Unauthorized", { status: 401 })
      )) as unknown as typeof globalThis.fetch;

    const reranker = createCohereReranker({ apiKey: "bad-key" });
    const results = [makeResult({ id: "a", content: "doc" })];

    expect(reranker("query", results)).rejects.toThrow("Cohere rerank failed (401)");
  });

  it("falls back to original order when API returns no results", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )) as unknown as typeof globalThis.fetch;

    const reranker = createCohereReranker({ apiKey: "test-key" });
    const results = [
      makeResult({ id: "a", content: "doc a" }),
      makeResult({ id: "b", content: "doc b" }),
    ];

    const output = await reranker("query", results);
    expect(output).toHaveLength(2);
    expect(output[0]!.id).toBe("a");
  });

  it("uses custom model name", async () => {
    let requestBody = "";
    globalThis.fetch = ((url: string, init: RequestInit) => {
      requestBody = init.body as string;
      return Promise.resolve(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }) as unknown as typeof globalThis.fetch;

    const reranker = createCohereReranker({
      apiKey: "test-key",
      model: "rerank-multilingual-v3.0",
    });
    await reranker("query", [makeResult({ id: "a", content: "doc" })]);

    const parsed = JSON.parse(requestBody);
    expect(parsed.model).toBe("rerank-multilingual-v3.0");
  });
});
