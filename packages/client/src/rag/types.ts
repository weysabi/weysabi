import type { ObjectStore } from "./object-store";
import type { HnswVectorIndex } from "./vector-index";
import type { Reranker } from "./reranker";

export interface RagOptions {
  embeddingModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  topK?: number;
  dbPath?: string;
  vectorIndex?: HnswVectorIndex;
  vectorIndexConfig?: {
    M?: number;
    Mmax?: number;
    Mmax0?: number;
    efConstruction?: number;
    efSearch?: number;
    numDimensions?: number;
  };
  objectStore?: ObjectStore;
  storeContentInObjectStore?: boolean;
  sqlitePragmas?: Record<string, string | number>;
  embeddingBatchSize?: number;
  reranker?: Reranker;
}

export interface RagChunk {
  id: string;
  fileId: string;
  filePath: string;
  chunkIndex: number;
  content: string;
  tokens: number;
  embedding?: Float32Array;
}

export interface RagSearchResult {
  id: string;
  content: string;
  filePath: string;
  score: number;
}

export interface RagQueryFilter {
  path?: string;
  pathPrefix?: string;
  fileId?: string;
}

export interface LoadResult {
  fileId: string;
  filePath: string;
  chunks: number;
  skipped: boolean;
}

export type LoadProgressEvent =
  | { type: "start"; total: number }
  | { type: "file_start"; filePath: string; current: number; total: number }
  | { type: "chunk"; filePath: string; chunks: number }
  | { type: "embed"; filePath: string; batch: number; total: number }
  | {
      type: "file_done";
      filePath: string;
      fileId: string;
      chunks: number;
      current: number;
      total: number;
    }
  | { type: "file_skip"; filePath: string; current: number; total: number }
  | { type: "error"; filePath: string; error: string; current: number; total: number }
  | { type: "done" };

export const DEFAULT_RAG_OPTIONS = {
  embeddingModel: "openai/text-embedding-3-small",
  chunkSize: 1000,
  chunkOverlap: 200,
  topK: 5,
  dbPath: ".sabi/rag.db",
  storeContentInObjectStore: false,
  embeddingBatchSize: 512,
} as const;
