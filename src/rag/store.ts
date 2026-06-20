import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import type { RagChunk, RagSearchResult, RagQueryFilter } from "./types";
import type { HnswVectorIndex } from "./vector-index";
import type { ObjectStore } from "./object-store";

export interface StoredFile {
  id: string;
  path: string;
  contentHash: string;
  createdAt: string;
}

export interface RagStoreConfig {
  dbPath: string;
  vectorIndex?: HnswVectorIndex;
  objectStore?: ObjectStore;
  storeContentInObjectStore?: boolean;
  pragmas?: Record<string, string | number>;
}

const DEFAULT_MILLION_SCALE_PRAGMAS: Record<string, string | number> = {
  journal_mode: "WAL",
  synchronous: "NORMAL",
  cache_size: -64000,
  busy_timeout: 5000,
  temp_store: "MEMORY",
  mmap_size: 268435456,
  foreign_keys: "ON",
  page_size: 65536,
};

function chunkContentKey(id: string): string {
  return `chunks/${id}`;
}

export class RagStore {
  private db: Database;
  memoryIndex: ChunkEntry[] = [];
  private vectorIndex: HnswVectorIndex | null;
  private objectStore: ObjectStore | null;
  private storeContentInObjectStore: boolean;
  private indexVersion = 0;
  private indexPath: string;

  constructor(config: RagStoreConfig) {
    const resolved = resolve(config.dbPath);
    const dir = dirname(resolved);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.indexPath = resolved + ".hnsw.idx";
    this.db = new Database(resolved);
    this.vectorIndex = config.vectorIndex ?? null;
    this.objectStore = config.objectStore ?? null;
    this.storeContentInObjectStore = config.storeContentInObjectStore ?? false;
    this.applyPragmas(config.pragmas ?? {});
    this.initSchema();
    this.initMetaTable();
    this.loadIndex();
  }

  private applyPragmas(overrides: Record<string, string | number>): void {
    const pragmas = { ...DEFAULT_MILLION_SCALE_PRAGMAS, ...overrides };
    for (const [key, value] of Object.entries(pragmas)) {
      this.db.run(`PRAGMA ${key} = ${value}`);
    }
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES files(id),
        chunk_index INTEGER NOT NULL,
        content TEXT,
        tokens INTEGER NOT NULL DEFAULT 0,
        embedding BLOB
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id, chunk_index)`);
    if (this.objectStore) {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS chunk_locations (
          chunk_id TEXT PRIMARY KEY REFERENCES chunks(id),
          store_key TEXT NOT NULL
        )
      `);
    }
  }

  private initMetaTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS _rag_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    const row = this.db
      .query(`SELECT value FROM _rag_meta WHERE key = 'index_version'`)
      .get() as { value: string } | undefined;
    this.indexVersion = row ? Number(row.value) : 0;
  }

  private incIndexVersion(): void {
    this.indexVersion++;
    this.db
      .query(`INSERT OR REPLACE INTO _rag_meta (key, value) VALUES ('index_version', ?)`)
      .run(String(this.indexVersion));
  }

  private loadIndex(): void {
    const needsEmbeds = !this.vectorIndex;

    const rows = this.db
      .query(
        needsEmbeds
          ? `SELECT c.id, c.file_id, c.chunk_index, c.content, c.tokens, c.embedding, f.path as file_path
             FROM chunks c JOIN files f ON c.file_id = f.id`
          : `SELECT c.id, c.file_id, c.chunk_index, c.content, c.tokens, NULL as embedding, f.path as file_path
             FROM chunks c JOIN files f ON c.file_id = f.id`
      )
      .all() as Array<{
      id: string;
      file_id: string;
      chunk_index: number;
      content: string | null;
      tokens: number;
      embedding: Uint8Array | null;
      file_path: string;
    }>;

    this.memoryIndex = [];
    for (const r of rows) {
      this.memoryIndex.push({
        id: r.id,
        fileId: r.file_id,
        chunkIndex: r.chunk_index,
        content: r.content ?? "",
        tokens: r.tokens,
        filePath: r.file_path,
        embedding: needsEmbeds && r.embedding ? new Float32Array(r.embedding.buffer) : null,
      });
    }

    if (!this.vectorIndex) return;

    const restored = this.tryRestoreIndex();
    if (restored) return;
    if (needsEmbeds) {
      this.rebuildVectorIndex();
    }
  }

  private tryRestoreIndex(): boolean {
    if (!existsSync(this.indexPath)) return false;

    try {
      const { restored, meta } = this.vectorIndex!.load(this.indexPath);
      if (!restored) return false;

      const savedVersion = (meta?.indexVersion ?? -1) as number;
      if (savedVersion !== this.indexVersion) return false;

      const storedCount = (
        this.db
          .query(`SELECT COUNT(*) as count FROM chunks`)
          .get() as { count: number }
      ).count;
      if (this.vectorIndex!.size() !== storedCount) return false;

      return true;
    } catch {
      return false;
    }
  }

  private rebuildVectorIndex(): void {
    if (!this.vectorIndex) return;

    const withEmbedding = this.memoryIndex.filter((c) => c.embedding);
    for (const entry of withEmbedding) {
      this.vectorIndex.add(entry.id, entry.embedding!);
    }

    this.persistVectorIndex();
  }

  private persistVectorIndex(): void {
    if (!this.vectorIndex) return;
    try {
      this.vectorIndex.save(this.indexPath, { indexVersion: this.indexVersion });
    } catch {
      // non-fatal
    }
  }

  hasFile(filePath: string, contentHash: string): boolean {
    const row = this.db
      .query(`SELECT content_hash FROM files WHERE path = ?`)
      .get(filePath) as { content_hash: string } | undefined;
    return row?.content_hash === contentHash;
  }

  insertFile(file: StoredFile): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO files (id, path, content_hash, created_at) VALUES (?, ?, ?, ?)`
      )
      .run(file.id, file.path, file.contentHash, file.createdAt);
  }

  insertChunks(chunks: RagChunk[]): void {
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO chunks (id, file_id, chunk_index, content, tokens, embedding) VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insertLocation = this.objectStore
      ? this.db.prepare(
          `INSERT OR REPLACE INTO chunk_locations (chunk_id, store_key) VALUES (?, ?)`
        )
      : null;

    this.db.transaction(() => {
      for (const chunk of chunks) {
        const embeddingBlob = chunk.embedding
          ? Buffer.from(chunk.embedding.buffer)
          : null;

        if (this.storeContentInObjectStore && this.objectStore && insertLocation) {
          const storeKey = chunkContentKey(chunk.id);
          insert.run(chunk.id, chunk.fileId, chunk.chunkIndex, null, chunk.tokens, embeddingBlob);
          insertLocation.run(chunk.id, storeKey);
          this.objectStore.put(storeKey, new TextEncoder().encode(chunk.content));
        } else {
          insert.run(chunk.id, chunk.fileId, chunk.chunkIndex, chunk.content, chunk.tokens, embeddingBlob);
        }

        if (this.vectorIndex && chunk.embedding) {
          this.vectorIndex.add(chunk.id, chunk.embedding);
        }
      }
    })();

    this.incIndexVersion();

    for (const chunk of chunks) {
      this.memoryIndex.push({
        id: chunk.id,
        fileId: chunk.fileId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tokens: chunk.tokens,
        filePath: chunk.filePath,
        embedding: chunk.embedding ?? null,
      });
    }

    this.persistVectorIndex();
  }

  deleteFile(fileId: string): void {
    const chunkIds = this.db
      .query(`SELECT id FROM chunks WHERE file_id = ?`)
      .all(fileId) as Array<{ id: string }>;

    this.db.transaction(() => {
      if (this.objectStore) {
        const locations = this.db
          .query(`SELECT store_key FROM chunk_locations WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = ?)`)
          .all(fileId) as Array<{ store_key: string }>;
        for (const loc of locations) {
          this.objectStore.delete(loc.store_key);
        }
        this.db.run(`DELETE FROM chunk_locations WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = ?)`, [fileId]);
      }
      this.db.run(`DELETE FROM chunks WHERE file_id = ?`, [fileId]);
      this.db.run(`DELETE FROM files WHERE id = ?`, [fileId]);
    })();

    this.incIndexVersion();

    for (const c of chunkIds) {
      this.vectorIndex?.remove(c.id);
    }
    this.memoryIndex = this.memoryIndex.filter((c) => c.fileId !== fileId);

    this.persistVectorIndex();
  }

  async search(
    queryEmbedding: Float32Array,
    topK: number,
    filter?: RagQueryFilter
  ): Promise<RagSearchResult[]> {
    if (this.vectorIndex) {
      return this.searchViaIndex(queryEmbedding, topK, filter);
    }
    return this.searchBruteForce(queryEmbedding, topK, filter);
  }

  private buildFilterConditions(filter?: RagQueryFilter): { clause: string; params: Array<string | number> } {
    if (!filter) return { clause: "", params: [] };

    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filter.path) {
      conditions.push("f.path = ?");
      params.push(filter.path);
    }
    if (filter.pathPrefix) {
      const prefix = filter.pathPrefix.endsWith("/") ? filter.pathPrefix : filter.pathPrefix + "/";
      conditions.push("f.path LIKE ?");
      params.push(prefix + "%");
    }
    if (filter.fileId) {
      conditions.push("c.file_id = ?");
      params.push(filter.fileId);
    }

    return {
      clause: conditions.length > 0 ? " AND " + conditions.join(" AND ") : "",
      params,
    };
  }

  private async searchViaIndex(
    queryEmbedding: Float32Array,
    topK: number,
    filter?: RagQueryFilter
  ): Promise<RagSearchResult[]> {
    const oversample = filter ? Math.min(topK * 5, 200) : topK;
    const results = this.vectorIndex!.search(queryEmbedding, oversample);
    if (results.length === 0) return [];

    const ids = results.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const { clause, params } = this.buildFilterConditions(filter);

    const bindings = [...ids, ...params] as [string, ...Array<string | number>];
    const chunkRows = this.db
      .query(
        `SELECT c.id, c.content, f.path as file_path
         FROM chunks c JOIN files f ON c.file_id = f.id
         WHERE c.id IN (${placeholders})${clause}`
      )
      .all(...bindings) as Array<{
      id: string;
      content: string | null;
      file_path: string;
    }>;

    const lookup = new Map(chunkRows.map((r) => [r.id, r]));
    const output: RagSearchResult[] = [];

    for (const r of results) {
      const row = lookup.get(r.id);
      if (!row) continue;

      let content = row.content ?? "";
      if (!content && this.objectStore) {
        const loc = this.db
          .query(`SELECT store_key FROM chunk_locations WHERE chunk_id = ?`)
          .get(r.id) as { store_key: string } | undefined;
        if (loc) {
          const data = await this.objectStore.get(loc.store_key);
          if (data) content = new TextDecoder().decode(data);
        }
      }

      output.push({ id: r.id, content, filePath: row.file_path, score: r.score });
      if (output.length >= topK) break;
    }

    return output;
  }

  private searchBruteForce(
    queryEmbedding: Float32Array,
    topK: number,
    filter?: RagQueryFilter
  ): RagSearchResult[] {
    let candidates = this.memoryIndex.filter((c) => c.embedding);

    if (filter) {
      candidates = candidates.filter((c) => {
        if (filter.path && c.filePath !== filter.path) return false;
        if (filter.pathPrefix) {
          const prefix = filter.pathPrefix.endsWith("/") ? filter.pathPrefix : filter.pathPrefix + "/";
          if (!c.filePath.startsWith(prefix)) return false;
        }
        if (filter.fileId && c.fileId !== filter.fileId) return false;
        return true;
      });
    }

    if (candidates.length === 0) return [];

    const scored: Array<RagSearchResult> = [];
    for (const entry of candidates) {
      const score = cosineSimilarity(queryEmbedding, entry.embedding!);
      scored.push({
        id: entry.id,
        content: entry.content,
        filePath: entry.filePath,
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  totalFiles(): number {
    return (
      this.db
        .query(`SELECT COUNT(*) as count FROM files`)
        .get() as { count: number }
    ).count;
  }

  totalChunks(): number {
    return (
      this.db
        .query(`SELECT COUNT(*) as count FROM chunks`)
        .get() as { count: number }
    ).count;
  }

  close(): void {
    this.persistVectorIndex();
    this.db.close();
  }
}

interface ChunkEntry {
  id: string;
  fileId: string;
  chunkIndex: number;
  content: string;
  tokens: number;
  filePath: string;
  embedding: Float32Array | null;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
