import type { Database } from "bun:sqlite";

export interface UsageRecord {
  keyFingerprint: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  timestamp: number;
  status: "success" | "error";
}

export interface UsageLedger {
  record(entry: UsageRecord): Promise<void>;
  query(opts?: {
    keyFingerprint?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ records: UsageRecord[]; total: number }>;
  stats(keyFingerprint?: string): Promise<{
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
    activeKeys: number;
  }>;
}

export class SqliteUsageLedger implements UsageLedger {
  private db: Database;
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  private constructor(db: Database) {
    this.db = db;
  }

  static async create(path = ".weysabi/ledger.db"): Promise<SqliteUsageLedger> {
    const { Database } = (await import("bun:sqlite")) as {
      Database: new (path: string) => Database;
    };
    const db = new Database(path);
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    db.run(`
      CREATE TABLE IF NOT EXISTS usage_records (
        key_fingerprint TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL,
        timestamp INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'success'
      )
    `);
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_ledger_key_ts ON usage_records(key_fingerprint, timestamp)"
    );
    db.run("CREATE INDEX IF NOT EXISTS idx_ledger_ts ON usage_records(timestamp)");
    const store = new SqliteUsageLedger(db);
    store.cleanupInterval = setInterval(() => {
      store.retainMax();
    }, 300_000);
    return store;
  }

  private retainMax(): void {
    const count = this.db.query("SELECT COUNT(*) as cnt FROM usage_records").get() as {
      cnt: number;
    };
    const maxRecords = 100_000;
    if (count.cnt > maxRecords * 1.1) {
      this.db.run(
        "DELETE FROM usage_records WHERE rowid IN (SELECT rowid FROM usage_records ORDER BY timestamp ASC LIMIT ?)",
        [count.cnt - maxRecords]
      );
    }
  }

  async record(entry: UsageRecord): Promise<void> {
    this.db.run(
      `INSERT INTO usage_records (key_fingerprint, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, timestamp, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.keyFingerprint,
        entry.model,
        entry.promptTokens,
        entry.completionTokens,
        entry.totalTokens,
        entry.estimatedCostUsd ?? null,
        entry.timestamp,
        entry.status,
      ]
    );
  }

  async query(opts?: {
    keyFingerprint?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ records: UsageRecord[]; total: number }> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;

    const cmp = opts?.keyFingerprint;

    const countRow = cmp
      ? (this.db
          .query("SELECT COUNT(*) as cnt FROM usage_records WHERE key_fingerprint = ?")
          .get(cmp) as { cnt: number })
      : (this.db.query("SELECT COUNT(*) as cnt FROM usage_records").get() as { cnt: number });

    const rows = cmp
      ? (this.db
          .query(
            "SELECT key_fingerprint, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, timestamp, status FROM usage_records WHERE key_fingerprint = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?"
          )
          .all(cmp, limit, offset) as Array<{
          key_fingerprint: string;
          model: string;
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
          estimated_cost_usd: number | null;
          timestamp: number;
          status: string;
        }>)
      : (this.db
          .query(
            "SELECT key_fingerprint, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, timestamp, status FROM usage_records ORDER BY timestamp DESC LIMIT ? OFFSET ?"
          )
          .all(limit, offset) as Array<{
          key_fingerprint: string;
          model: string;
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
          estimated_cost_usd: number | null;
          timestamp: number;
          status: string;
        }>);

    const records: UsageRecord[] = rows.map((r) => ({
      keyFingerprint: r.key_fingerprint,
      model: r.model,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      totalTokens: r.total_tokens,
      estimatedCostUsd: r.estimated_cost_usd ?? undefined,
      timestamp: r.timestamp,
      status: r.status as "success" | "error",
    }));

    return { records, total: countRow.cnt };
  }

  async stats(keyFingerprint?: string): Promise<{
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
    activeKeys: number;
  }> {
    if (keyFingerprint) {
      const row = this.db
        .query(
          "SELECT COUNT(*) as total_requests, COALESCE(SUM(total_tokens), 0) as total_tokens, COALESCE(SUM(estimated_cost_usd), 0) as total_cost_usd FROM usage_records WHERE key_fingerprint = ?"
        )
        .get(keyFingerprint) as {
        total_requests: number;
        total_tokens: number;
        total_cost_usd: number;
      };
      const keysRow = this.db
        .query(
          "SELECT COUNT(DISTINCT key_fingerprint) as active_keys FROM usage_records WHERE key_fingerprint = ?"
        )
        .get(keyFingerprint) as { active_keys: number };
      return {
        totalRequests: row.total_requests,
        totalTokens: row.total_tokens,
        totalCostUsd: row.total_cost_usd,
        activeKeys: keysRow.active_keys,
      };
    }

    const row = this.db
      .query(
        "SELECT COUNT(*) as total_requests, COALESCE(SUM(total_tokens), 0) as total_tokens, COALESCE(SUM(estimated_cost_usd), 0) as total_cost_usd FROM usage_records"
      )
      .get() as {
      total_requests: number;
      total_tokens: number;
      total_cost_usd: number;
    };
    const keysRow = this.db
      .query("SELECT COUNT(DISTINCT key_fingerprint) as active_keys FROM usage_records")
      .get() as { active_keys: number };
    return {
      totalRequests: row.total_requests,
      totalTokens: row.total_tokens,
      totalCostUsd: row.total_cost_usd,
      activeKeys: keysRow.active_keys,
    };
  }

  close(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.db.close();
  }
}

export class InMemoryUsageLedger implements UsageLedger {
  private records: UsageRecord[] = [];

  constructor(private readonly maxRecords = 10_000) {
    if (!Number.isInteger(maxRecords) || maxRecords < 1) {
      throw new Error("maxRecords must be a positive integer");
    }
  }

  async record(entry: UsageRecord): Promise<void> {
    this.records.push(entry);
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
  }

  async query(opts?: {
    keyFingerprint?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ records: UsageRecord[]; total: number }> {
    let filtered = this.records;
    if (opts?.keyFingerprint) {
      filtered = filtered.filter((r) => r.keyFingerprint === opts.keyFingerprint);
    }
    const ordered = [...filtered].sort((a, b) => b.timestamp - a.timestamp);
    const total = ordered.length;
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    const records = ordered.slice(offset, offset + limit);
    return { records, total };
  }

  async stats(keyFingerprint?: string): Promise<{
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
    activeKeys: number;
  }> {
    let filtered = this.records;
    if (keyFingerprint) {
      filtered = filtered.filter((r) => r.keyFingerprint === keyFingerprint);
    }
    return {
      totalRequests: filtered.length,
      totalTokens: filtered.reduce((sum, r) => sum + r.totalTokens, 0),
      totalCostUsd: filtered.reduce((sum, r) => sum + (r.estimatedCostUsd ?? 0), 0),
      activeKeys: new Set(filtered.map((record) => record.keyFingerprint)).size,
    };
  }
}
