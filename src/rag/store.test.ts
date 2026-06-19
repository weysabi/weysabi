import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { RagStore } from "./store";
import { generateId } from "../utils";

const TEST_DB = ".sabi/test-rag-store.db";

describe("RagStore", () => {
  let store: RagStore;

  beforeEach(() => {
    try { unlinkSync(TEST_DB); } catch {}
    store = new RagStore({ dbPath: TEST_DB });
  });

  afterEach(() => {
    store.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("starts empty", () => {
    expect(store.totalFiles()).toBe(0);
    expect(store.totalChunks()).toBe(0);
  });

  it("inserts and tracks files", () => {
    const fileId = generateId();
    store.insertFile({
      id: fileId,
      path: "/test/doc.md",
      contentHash: "abc123",
      createdAt: new Date().toISOString(),
    });

    expect(store.totalFiles()).toBe(1);
  });

  it("detects duplicate files by content hash", () => {
    const fileId = generateId();
    store.insertFile({
      id: fileId,
      path: "/test/doc.md",
      contentHash: "abc123",
      createdAt: new Date().toISOString(),
    });

    expect(store.hasFile("/test/doc.md", "abc123")).toBe(true);
    expect(store.hasFile("/test/doc.md", "different")).toBe(false);
  });

  it("inserts chunks with embeddings", () => {
    const fileId = "f1";
    store.insertFile({
      id: fileId,
      path: "/test/doc.md",
      contentHash: "abc",
      createdAt: new Date().toISOString(),
    });

    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    store.insertChunks([
      {
        id: "c1",
        fileId,
        filePath: "/test/doc.md",
        chunkIndex: 0,
        content: "Hello world",
        tokens: 3,
        embedding,
      },
    ]);

    expect(store.totalChunks()).toBe(1);
  });

  it("searches by cosine similarity", async () => {
    const fileId = "f1";
    store.insertFile({
      id: fileId,
      path: "/test/doc.md",
      contentHash: "abc",
      createdAt: new Date().toISOString(),
    });

    store.insertChunks([
      {
        id: "c1",
        fileId,
        filePath: "/test/doc.md",
        chunkIndex: 0,
        content: "The sky is blue",
        tokens: 4,
        embedding: new Float32Array([1, 0, 0, 0]),
      },
      {
        id: "c2",
        fileId,
        filePath: "/test/doc.md",
        chunkIndex: 1,
        content: "Dogs love walks",
        tokens: 3,
        embedding: new Float32Array([0, 1, 0, 0]),
      },
    ]);

    const results = await store.search(new Float32Array([0.9, 0.1, 0, 0]), 2);
    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe("c1");
  });

  it("deletes a file and its chunks", () => {
    const fileId = "f1";
    store.insertFile({
      id: fileId,
      path: "/test/doc.md",
      contentHash: "abc",
      createdAt: new Date().toISOString(),
    });
    store.insertChunks([
      {
        id: "c1",
        fileId,
        filePath: "/test/doc.md",
        chunkIndex: 0,
        content: "test",
        tokens: 1,
        embedding: new Float32Array([0.1, 0.2]),
      },
    ]);

    store.deleteFile(fileId);
    expect(store.totalFiles()).toBe(0);
    expect(store.totalChunks()).toBe(0);
  });
});
