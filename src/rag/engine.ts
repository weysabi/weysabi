import { resolve, basename } from "path";
import { existsSync, statSync } from "fs";
import { generateId } from "../utils";
import { RagStore } from "./store";
import { splitText } from "./chunker";
import { embedText, embedBatch } from "./embedder";
import { loadFile, loadDirectory, loadText, type LoadedFile } from "./loader";
import type { RagOptions, RagChunk, RagSearchResult, LoadResult, RagQueryFilter } from "./types";
import type { ProviderConfig } from "../types";
import { DEFAULT_RAG_OPTIONS } from "./types";
import { HnswVectorIndex } from "./vector-index";

export class RagEngine {
  private store: RagStore;
  options: RagOptions & {
    embeddingModel: string;
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
    dbPath: string;
    storeContentInObjectStore: boolean;
    sqlitePragmas?: Record<string, string | number>;
  };
  vectorIndex: HnswVectorIndex | null;
  private embeddingProvider: ProviderConfig & { provider: string } | null = null;
  private fallbackProviders: Record<string, ProviderConfig> = {};

  constructor(options: RagOptions = {}) {
    const defaults = DEFAULT_RAG_OPTIONS;
    this.options = {
      ...defaults,
      ...options,
      embeddingModel: options.embeddingModel ?? defaults.embeddingModel!,
      chunkSize: options.chunkSize ?? defaults.chunkSize!,
      chunkOverlap: options.chunkOverlap ?? defaults.chunkOverlap!,
      topK: options.topK ?? defaults.topK!,
      dbPath: options.dbPath ?? defaults.dbPath!,
      storeContentInObjectStore: options.storeContentInObjectStore ?? defaults.storeContentInObjectStore!,
    } as typeof this.options;
    this.vectorIndex = this.buildVectorIndex();
    this.store = new RagStore({
      dbPath: this.options.dbPath,
      vectorIndex: this.vectorIndex ?? undefined,
      objectStore: this.options.objectStore || undefined,
      storeContentInObjectStore: this.options.storeContentInObjectStore,
      pragmas: this.options.sqlitePragmas,
    });
  }

  private buildVectorIndex(): HnswVectorIndex | null {
    if (this.options.vectorIndex) return this.options.vectorIndex;
    if (this.options.vectorIndexConfig) {
      return new HnswVectorIndex(this.options.vectorIndexConfig);
    }
    const dimensions = this.inferDimensions();
    return dimensions > 0 ? new HnswVectorIndex({ numDimensions: dimensions }) : null;
  }

  private inferDimensions(): number {
    const model = this.options.embeddingModel;
    if (model?.includes("text-embedding-3-small")) return 1536;
    if (model?.includes("text-embedding-3-large")) return 3072;
    if (model?.includes("text-embedding-ada")) return 1536;
    if (model?.includes("llama")) return 4096;
    return 1536;
  }

  setProviders(
    embeddingProvider: ProviderConfig & { provider: string },
    fallbacks: Record<string, ProviderConfig>
  ): void {
    this.embeddingProvider = embeddingProvider;
    this.fallbackProviders = fallbacks;
  }

  async load(...sources: Array<string | { name: string; content: string }>): Promise<LoadResult[]> {
    if (!this.embeddingProvider) {
      throw new Error("RAG: no embedding provider configured. Call sabi.rag.setProviders() or pass embeddingProvider in options.");
    }

    const files: LoadedFile[] = [];

    for (const source of sources) {
      if (typeof source === "string") {
        if (existsSync(source) && statSync(source).isDirectory()) {
          files.push(...loadDirectory(source));
        } else if (existsSync(source) && statSync(source).isFile()) {
          files.push(loadFile(source));
        } else {
          files.push(loadText(basename(source), source));
        }
      } else {
        files.push(loadText(source.name, source.content));
      }
    }

    const results: LoadResult[] = [];

    for (const file of files) {
      if (this.store.hasFile(file.path, file.contentHash)) {
        results.push({
          fileId: "",
          filePath: file.path,
          chunks: 0,
          skipped: true,
        });
        continue;
      }

      const fileId = generateId();
      this.store.insertFile({
        id: fileId,
        path: file.path,
        contentHash: file.contentHash,
        createdAt: new Date().toISOString(),
      });

      const chunks = splitText(file.content, this.options.chunkSize, this.options.chunkOverlap);
      const ragChunks: RagChunk[] = [];

      for (let i = 0; i < chunks.length; i++) {
        ragChunks.push({
          id: generateId(),
          fileId,
          filePath: file.path,
          chunkIndex: i,
          content: chunks[i]!.content,
          tokens: chunks[i]!.tokens,
        });
      }

      const texts = ragChunks.map((c) => c.content);
      const embeddings = await embedBatch(texts, this.embeddingProvider, this.options.embeddingModel);

      for (let i = 0; i < ragChunks.length; i++) {
        ragChunks[i]!.embedding = embeddings[i]!.embedding;
      }

      this.store.insertChunks(ragChunks);

      results.push({
        fileId,
        filePath: file.path,
        chunks: ragChunks.length,
        skipped: false,
      });
    }

    return results;
  }

  async query(question: string, topK?: number, filter?: RagQueryFilter): Promise<RagSearchResult[]> {
    if (!this.embeddingProvider) {
      throw new Error("RAG: no embedding provider configured.");
    }

    const k = topK ?? this.options.topK;

    const { embedding } = await embedText(
      question,
      this.embeddingProvider,
      this.options.embeddingModel
    );

    return this.store.search(embedding, k, filter);
  }

  clear(filePath?: string): void {
    if (filePath) {
      const existing = this.store["memoryIndex"].filter(
        (c) => c.filePath === resolve(filePath)
      );
      for (const chunk of existing) {
        this.vectorIndex?.remove(chunk.id);
        this.store.deleteFile(chunk.fileId);
      }
    } else {
      const files = this.store["db"]
        .query(`SELECT id FROM files`)
        .all() as Array<{ id: string }>;
      for (const f of files) {
        const chunkIds = this.store["db"]
          .query(`SELECT id FROM chunks WHERE file_id = ?`)
          .all(f.id) as Array<{ id: string }>;
        for (const c of chunkIds) {
          this.vectorIndex?.remove(c.id);
        }
        this.store.deleteFile(f.id);
      }
    }
  }

  stats(): { files: number; chunks: number } {
    return {
      files: this.store.totalFiles(),
      chunks: this.store.totalChunks(),
    };
  }

  close(): void {
    this.store.close();
  }
}
