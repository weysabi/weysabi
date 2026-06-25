import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync, readdirSync } from "fs";
import { resolve } from "path";
import { RagEngine } from "./engine";

let testId = 0;

const DB_PATTERN = /^test-rag-engine-\d+\.db/;

beforeAll(() => {
  const dir = ".sabi";
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (DB_PATTERN.test(entry) || DB_PATTERN.test(entry.replace(/-(wal|shm)$/, ""))) {
      try {
        unlinkSync(resolve(dir, entry));
      } catch {
        /* best effort */
      }
    }
  }
});

function deterministicEmbedding(text: string, dims = 4): number[] {
  const vec: number[] = [];
  for (let i = 0; i < dims; i++) {
    let hash = 0;
    for (let j = 0; j < text.length; j++) {
      hash = ((hash << 5) - hash + text.charCodeAt(j) + i * 7) | 0;
    }
    vec.push(Math.abs(hash % 100) / 100);
  }
  return vec;
}

function mockFetch(): void {
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse((init as RequestInit).body as string);
    const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];

    const data = inputs.map((text, index) => ({
      embedding: deterministicEmbedding(text),
      index,
    }));

    return new Response(
      JSON.stringify({
        data,
        usage: { prompt_tokens: inputs.length * 5, total_tokens: inputs.length * 5 },
        model: "text-embedding-3-small",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

function dbPath(): string {
  testId++;
  return `.sabi/test-rag-engine-${testId}.db`;
}

function makeEngine(): { engine: RagEngine; cleanup: () => void } {
  const path = dbPath();
  const engine = new RagEngine({
    dbPath: path,
    embeddingModel: "test/text-embedding",
    chunkSize: 100,
    chunkOverlap: 0,
    topK: 5,
  });
  engine.setProviders({ provider: "openai", apiKey: "test-key" }, {});
  function clean(): void {
    engine.close();
    for (const suffix of ["", ".hnsw.idx", ".hnsw.vec", "-wal", "-shm"]) {
      try {
        unlinkSync(path + suffix);
      } catch {
        /* best effort */
      }
    }
  }

  return { engine, cleanup: clean };
}

describe("RagEngine", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("starts empty", () => {
    const { engine, cleanup } = makeEngine();
    expect(engine.stats().files).toBe(0);
    expect(engine.stats().chunks).toBe(0);
    cleanup();
  });

  it("loads inline text and stores chunks", async () => {
    const { engine, cleanup } = makeEngine();
    const results = await engine.load({
      name: "test.md",
      content: "Hello world. This is a test document for the RAG engine.",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.filePath).toEndWith("test.md");
    expect(results[0]!.chunks).toBeGreaterThan(0);
    expect(results[0]!.skipped).toBe(false);
    expect(engine.stats().files).toBe(1);
    expect(engine.stats().chunks).toBeGreaterThan(0);
    cleanup();
  });

  it("deduplicates by content hash", async () => {
    const { engine, cleanup } = makeEngine();
    await engine.load({ name: "dup.md", content: "Duplicate content" });
    const results = await engine.load({ name: "dup.md", content: "Duplicate content" });
    expect(results[0]!.skipped).toBe(true);
    cleanup();
  });

  it("queries after loading text", async () => {
    const { engine, cleanup } = makeEngine();
    await engine.load({
      name: "doc.md",
      content: "The sky is blue and clouds are white.",
    });
    const results = await engine.query("sky");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.content).toContain("sky");
    expect(results[0]!.score).toBeGreaterThan(0);
    cleanup();
  });

  it("returns results sorted by relevance", async () => {
    const { engine, cleanup } = makeEngine();
    await engine.load(
      { name: "cats.md", content: "Cats are furry animals that purr and nap in sunbeams." },
      { name: "dogs.md", content: "Dogs are loyal pets that love to play fetch and run." },
      { name: "weather.md", content: "The weather today is sunny with a chance of clouds." }
    );
    const results = await engine.query("furry pet", 3);
    expect(results).toHaveLength(3);
    expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
    cleanup();
  });

  it("queries with topK limit", async () => {
    const { engine, cleanup } = makeEngine();
    await engine.load(
      { name: "a.md", content: "Alpha is the first letter." },
      { name: "b.md", content: "Beta is the second letter." },
      { name: "c.md", content: "Gamma is the third letter." }
    );
    const results = await engine.query("letter", 2);
    expect(results.length).toBeLessThanOrEqual(2);
    cleanup();
  });

  it("throws on query without provider configuration", async () => {
    const path = dbPath();
    const engine = new RagEngine({ dbPath: path, embeddingModel: "test/model", chunkSize: 100 });
    await expect(engine.query("test")).rejects.toThrow("embedding provider");
    engine.close();
    try {
      unlinkSync(path);
    } catch {
      /* file may not exist */
    }
    try {
      unlinkSync(path + ".hnsw.idx");
    } catch {
      /* file may not exist */
    }
  });

  it("clear removes all data", async () => {
    const { engine, cleanup } = makeEngine();
    await engine.load({ name: "doc.md", content: "Something to clear." });
    expect(engine.stats().files).toBe(1);
    engine.clear();
    expect(engine.stats().files).toBe(0);
    expect(engine.stats().chunks).toBe(0);
    cleanup();
  });

  it("clear with file path removes specific file", async () => {
    const { engine, cleanup } = makeEngine();
    await engine.load(
      { name: "keep.md", content: "Keep this file." },
      { name: "remove.md", content: "Remove this file." }
    );
    expect(engine.stats().files).toBe(2);
    engine.clear(resolve(".sabi/rag/files/remove.md"));
    expect(engine.stats().files).toBe(1);
    cleanup();
  });

  it("loadStream yields progress events", async () => {
    const { engine, cleanup } = makeEngine();
    const events: string[] = [];
    for await (const event of engine.loadStream({
      name: "stream.md",
      content: "Streaming test content for progress.",
    })) {
      events.push(event.type);
    }
    expect(events.length).toBeGreaterThan(0);
    cleanup();
  });

  it("handles empty content gracefully", async () => {
    const { engine, cleanup } = makeEngine();
    const results = await engine.load({ name: "empty.md", content: "" });
    expect(results[0]!.chunks).toBe(0);
    cleanup();
  });

  it("loads multiple sources in one call", async () => {
    const { engine, cleanup } = makeEngine();
    const results = await engine.load(
      { name: "one.md", content: "First document content for testing." },
      { name: "two.md", content: "Second document content for testing." }
    );
    expect(results).toHaveLength(2);
    expect(engine.stats().files).toBe(2);
    cleanup();
  });
});
