import type { Database } from "bun:sqlite";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
} from "fs";
import { join, resolve, dirname, relative } from "path";

export interface ObjectStore {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  list(prefix?: string): AsyncIterable<string>;
}

export class FsObjectStore implements ObjectStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir);
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private path(key: string): string {
    const p = join(this.baseDir, key);
    const resolved = resolve(p);
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error(`ObjectStore key escapes base directory: ${key}`);
    }
    return resolved;
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return readFileSync(this.path(key));
    } catch {
      return null;
    }
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const p = this.path(key);
    const dir = dirname(p);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(p, data);
  }

  async delete(key: string): Promise<void> {
    try {
      unlinkSync(this.path(key));
    } catch {
      // ignore
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      return statSync(this.path(key)).isFile();
    } catch {
      return false;
    }
  }

  async *list(prefix: string = ""): AsyncIterable<string> {
    const dir = join(this.baseDir, prefix);
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { recursive: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry as string);
      if (statSync(fullPath).isFile()) {
        yield relative(this.baseDir, fullPath).replace(/\\/g, "/");
      }
    }
  }
}

export class SqliteObjectStore implements ObjectStore {
  private db: Database;
  private tableName: string;

  constructor(db: Database, tableName: string = "objects") {
    this.db = db;
    this.tableName = tableName;
    this.db.run(
      `CREATE TABLE IF NOT EXISTS ${tableName} (
        key TEXT PRIMARY KEY,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    const row = this.db.query(`SELECT data FROM ${this.tableName} WHERE key = ?`).get(key) as
      | { data: Uint8Array }
      | undefined;
    return row?.data ?? null;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    this.db
      .query(`INSERT OR REPLACE INTO ${this.tableName} (key, data) VALUES (?, ?)`)
      .run(key, data);
  }

  async delete(key: string): Promise<void> {
    this.db.query(`DELETE FROM ${this.tableName} WHERE key = ?`).run(key);
  }

  async has(key: string): Promise<boolean> {
    const row = this.db.query(`SELECT 1 FROM ${this.tableName} WHERE key = ?`).get(key);
    return row !== undefined;
  }

  async *list(prefix: string = ""): AsyncIterable<string> {
    const rows = this.db
      .query(`SELECT key FROM ${this.tableName} WHERE key LIKE ?`)
      .all(`${prefix}%`) as Array<{ key: string }>;
    for (const row of rows) {
      yield row.key;
    }
  }

  clear(): void {
    this.db.run(`DELETE FROM ${this.tableName}`);
  }
}
