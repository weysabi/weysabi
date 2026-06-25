import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync } from "fs";
import { RagStore } from "./store";
import { generateId } from "../utils";
import type { ObjectStore } from "./object-store";

const TEST_DB = ".sabi/test-rag-store.db";

describe("RagStore", () => {
  let store: RagStore;

  beforeEach(() => {
    try {
      unlinkSync(TEST_DB);
    } catch {
      /* db may not exist */
    }
    store = new RagStore({ dbPath: TEST_DB });
  });

  afterEach(() => {
    store.close();
    try {
      unlinkSync(TEST_DB);
    } catch {
      /* db may not exist */
    }
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

  it("inserts chunks with embeddings", async () => {
    const fileId = "f1";
    store.insertFile({
      id: fileId,
      path: "/test/doc.md",
      contentHash: "abc",
      createdAt: new Date().toISOString(),
    });

    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    await store.insertChunks([
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

    await store.insertChunks([
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

  it("deletes a file and its chunks", async () => {
    const fileId = "f1";
    store.insertFile({
      id: fileId,
      path: "/test/doc.md",
      contentHash: "abc",
      createdAt: new Date().toISOString(),
    });
    await store.insertChunks([
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

describe("RagStore object-store persistence", () => {
  it("waits for object content to persist before committing chunk metadata", async () => {
    const dbPath = `.sabi/test-rag-object-${generateId()}.db`;
    let releasePut: (() => void) | undefined;
    const objects = new Map<string, Uint8Array>();
    const objectStore: ObjectStore = {
      async get(key) {
        return objects.get(key) ?? null;
      },
      async put(key, data) {
        await new Promise<void>((resolve) => {
          releasePut = resolve;
        });
        objects.set(key, data);
      },
      async delete(key) {
        objects.delete(key);
      },
      async has(key) {
        return objects.has(key);
      },
      async *list() {
        yield* objects.keys();
      },
    };
    const objectBacked = new RagStore({
      dbPath,
      objectStore,
      storeContentInObjectStore: true,
    });

    try {
      objectBacked.insertFile({
        id: "file",
        path: "/test/object.md",
        contentHash: "hash",
        createdAt: new Date().toISOString(),
      });
      const pending = objectBacked.insertChunks([
        {
          id: "chunk",
          fileId: "file",
          filePath: "/test/object.md",
          chunkIndex: 0,
          content: "stored remotely",
          tokens: 2,
          embedding: new Float32Array([1, 0]),
        },
      ]);

      await Promise.resolve();
      expect(objectBacked.totalChunks()).toBe(0);
      releasePut?.();
      await pending;
      expect(objectBacked.totalChunks()).toBe(1);
      expect(objects.has("chunks/chunk")).toBe(true);
    } finally {
      objectBacked.close();
      for (const suffix of ["", "-wal", "-shm", ".hnsw.idx", ".hnsw.vec"]) {
        try {
          unlinkSync(dbPath + suffix);
        } catch {
          /* best effort */
        }
      }
    }
  });
});
