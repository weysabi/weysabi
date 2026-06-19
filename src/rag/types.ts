import type { ObjectStore } from "./object-store";
import type { HnswVectorIndex } from "./vector-index";

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

export interface LoadResult {
  fileId: string;
  filePath: string;
  chunks: number;
  skipped: boolean;
}

export const DEFAULT_RAG_OPTIONS = {
  embeddingModel: "openai/text-embedding-3-small",
  chunkSize: 1000,
  chunkOverlap: 200,
  topK: 5,
  dbPath: ".sabi/rag.db",
  storeContentInObjectStore: false,
} as const;
