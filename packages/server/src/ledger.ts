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

export interface DailyUsage {
  date: string;
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface QueryOptions {
  keyFingerprint?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export interface UsageLedger {
  record(entry: UsageRecord): Promise<void>;
  query(opts?: QueryOptions): Promise<{ records: UsageRecord[]; total: number }>;
  stats(opts?: { keyFingerprint?: string; from?: number; to?: number }): Promise<{
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
    activeKeys: number;
  }>;
  dailyStats(opts?: { keyFingerprint?: string; from?: number; to?: number }): Promise<DailyUsage[]>;
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

  async query(opts?: QueryOptions): Promise<{ records: UsageRecord[]; total: number }> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    const cmp = opts?.keyFingerprint;
    const from = opts?.from;
    const to = opts?.to;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (cmp) {
      conditions.push("key_fingerprint = ?");
      params.push(cmp);
    }
    if (from != null) {
      conditions.push("timestamp >= ?");
      params.push(from);
    }
    if (to != null) {
      conditions.push("timestamp <= ?");
      params.push(to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const p = params as (string | number)[];

    const countRow = this.db
      .query(`SELECT COUNT(*) as cnt FROM usage_records ${where}`)
      .get(...p) as { cnt: number };

    const rows = this.db
      .query(
        `SELECT key_fingerprint, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, timestamp, status FROM usage_records ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
      )
      .all(...p, limit, offset) as Array<{
      key_fingerprint: string;
      model: string;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      estimated_cost_usd: number | null;
      timestamp: number;
      status: string;
    }>;

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

  async stats(opts?: { keyFingerprint?: string; from?: number; to?: number }): Promise<{
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
    activeKeys: number;
  }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.keyFingerprint) {
      conditions.push("key_fingerprint = ?");
      params.push(opts.keyFingerprint);
    }
    if (opts?.from != null) {
      conditions.push("timestamp >= ?");
      params.push(opts.from);
    }
    if (opts?.to != null) {
      conditions.push("timestamp <= ?");
      params.push(opts.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const p = params as (string | number)[];

    const row = this.db
      .query(
        `SELECT COUNT(*) as total_requests, COALESCE(SUM(total_tokens), 0) as total_tokens, COALESCE(SUM(estimated_cost_usd), 0) as total_cost_usd FROM usage_records ${where}`
      )
      .get(...p) as {
      total_requests: number;
      total_tokens: number;
      total_cost_usd: number;
    };

    const keyConditions = opts?.keyFingerprint ? "WHERE key_fingerprint = ?" : "";
    const keyParams = opts?.keyFingerprint ? [opts.keyFingerprint] : [];
    const keysRow = this.db
      .query(
        `SELECT COUNT(DISTINCT key_fingerprint) as active_keys FROM usage_records ${keyConditions}`
      )
      .get(...keyParams) as { active_keys: number };

    return {
      totalRequests: row.total_requests,
      totalTokens: row.total_tokens,
      totalCostUsd: row.total_cost_usd,
      activeKeys: keysRow.active_keys,
    };
  }

  async dailyStats(opts?: {
    keyFingerprint?: string;
    from?: number;
    to?: number;
  }): Promise<DailyUsage[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.keyFingerprint) {
      conditions.push("key_fingerprint = ?");
      params.push(opts.keyFingerprint);
    }
    if (opts?.from != null) {
      conditions.push("timestamp >= ?");
      params.push(opts.from);
    }
    if (opts?.to != null) {
      conditions.push("timestamp <= ?");
      params.push(opts.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const p = params as (string | number)[];

    const rows = this.db
      .query(
        `SELECT date(timestamp / 1000, 'unixepoch') as day, COUNT(*) as requests, COALESCE(SUM(total_tokens), 0) as tokens, COALESCE(SUM(estimated_cost_usd), 0) as cost_usd FROM usage_records ${where} GROUP BY day ORDER BY day ASC`
      )
      .all(...p) as Array<{
      day: string;
      requests: number;
      tokens: number;
      cost_usd: number;
    }>;

    return rows.map((r) => ({
      date: r.day,
      requests: r.requests,
      tokens: r.tokens,
      costUsd: r.cost_usd,
    }));
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

  async query(opts?: QueryOptions): Promise<{ records: UsageRecord[]; total: number }> {
    let filtered = this.records;
    if (opts?.keyFingerprint) {
      filtered = filtered.filter((r) => r.keyFingerprint === opts.keyFingerprint);
    }
    if (opts?.from != null) {
      filtered = filtered.filter((r) => r.timestamp >= opts.from!);
    }
    if (opts?.to != null) {
      filtered = filtered.filter((r) => r.timestamp <= opts.to!);
    }
    const ordered = [...filtered].sort((a, b) => b.timestamp - a.timestamp);
    const total = ordered.length;
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    const records = ordered.slice(offset, offset + limit);
    return { records, total };
  }

  async stats(opts?: { keyFingerprint?: string; from?: number; to?: number }): Promise<{
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
    activeKeys: number;
  }> {
    let filtered = this.records;
    if (opts?.keyFingerprint) {
      filtered = filtered.filter((r) => r.keyFingerprint === opts.keyFingerprint);
    }
    if (opts?.from != null) {
      filtered = filtered.filter((r) => r.timestamp >= opts.from!);
    }
    if (opts?.to != null) {
      filtered = filtered.filter((r) => r.timestamp <= opts.to!);
    }
    return {
      totalRequests: filtered.length,
      totalTokens: filtered.reduce((sum, r) => sum + r.totalTokens, 0),
      totalCostUsd: filtered.reduce((sum, r) => sum + (r.estimatedCostUsd ?? 0), 0),
      activeKeys: new Set(filtered.map((record) => record.keyFingerprint)).size,
    };
  }

  async dailyStats(opts?: {
    keyFingerprint?: string;
    from?: number;
    to?: number;
  }): Promise<DailyUsage[]> {
    let filtered = this.records;
    if (opts?.keyFingerprint) {
      filtered = filtered.filter((r) => r.keyFingerprint === opts.keyFingerprint);
    }
    if (opts?.from != null) {
      filtered = filtered.filter((r) => r.timestamp >= opts.from!);
    }
    if (opts?.to != null) {
      filtered = filtered.filter((r) => r.timestamp <= opts.to!);
    }

    const dayBuckets = new Map<string, { requests: number; tokens: number; costUsd: number }>();
    for (const r of filtered) {
      const day = new Date(r.timestamp).toISOString().slice(0, 10);
      const bucket = dayBuckets.get(day) ?? { requests: 0, tokens: 0, costUsd: 0 };
      bucket.requests++;
      bucket.tokens += r.totalTokens;
      bucket.costUsd += r.estimatedCostUsd ?? 0;
      dayBuckets.set(day, bucket);
    }

    return Array.from(dayBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, stats]) => ({
        date,
        requests: stats.requests,
        tokens: stats.tokens,
        costUsd: stats.costUsd,
      }));
  }
}
