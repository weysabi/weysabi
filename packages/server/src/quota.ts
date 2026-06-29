export interface TokenQuotaConfig {
  maxTokensPerMin?: number;
  maxTokensPerDay?: number;
}

export interface QuotaReservation {
  id: string;
  key: string;
  reservedTokens: number;
}

export type QuotaReservationResult =
  | { allowed: true; reservation: QuotaReservation }
  | { allowed: false; reason: string };

export interface TokenQuotaStore {
  reserve(
    key: string,
    estimatedTokens: number,
    config: TokenQuotaConfig
  ): Promise<QuotaReservationResult>;
  commit(reservationId: string, actualTokens: number): Promise<void>;
  release(reservationId: string): Promise<void>;
}

interface UsageEntry {
  timestamp: number;
  tokens: number;
}

interface PendingReservation extends QuotaReservation {
  createdAt: number;
  expiresAt: number;
}

import type { Database } from "bun:sqlite";

export class InMemoryTokenQuotaStore implements TokenQuotaStore {
  private windows = new Map<string, UsageEntry[]>();
  private reservations = new Map<string, PendingReservation>();

  constructor(private readonly reservationTtlMs = 5 * 60_000) {}

  async reserve(
    key: string,
    estimatedTokens: number,
    config: TokenQuotaConfig
  ): Promise<QuotaReservationResult> {
    if (!Number.isInteger(estimatedTokens) || estimatedTokens < 1) {
      throw new Error("estimatedTokens must be a positive integer");
    }

    const now = Date.now();
    this.cleanup(now);
    const entries = this.windows.get(key) ?? [];
    const pendingTokens = [...this.reservations.values()]
      .filter((reservation) => reservation.key === key)
      .reduce((sum, reservation) => sum + reservation.reservedTokens, 0);

    if (config.maxTokensPerMin !== undefined) {
      const minuteTokens =
        entries
          .filter((entry) => entry.timestamp > now - 60_000)
          .reduce((sum, entry) => sum + entry.tokens, 0) + pendingTokens;
      if (minuteTokens + estimatedTokens > config.maxTokensPerMin) {
        return {
          allowed: false,
          reason: `Token quota exceeded: ${minuteTokens}/${config.maxTokensPerMin} per minute`,
        };
      }
    }

    if (config.maxTokensPerDay !== undefined) {
      const dayTokens =
        entries
          .filter((entry) => entry.timestamp > now - 86_400_000)
          .reduce((sum, entry) => sum + entry.tokens, 0) + pendingTokens;
      if (dayTokens + estimatedTokens > config.maxTokensPerDay) {
        return {
          allowed: false,
          reason: `Token quota exceeded: ${dayTokens}/${config.maxTokensPerDay} per day`,
        };
      }
    }

    const reservation: PendingReservation = {
      id: crypto.randomUUID(),
      key,
      reservedTokens: estimatedTokens,
      createdAt: now,
      expiresAt: now + this.reservationTtlMs,
    };
    this.reservations.set(reservation.id, reservation);
    return { allowed: true, reservation };
  }

  async commit(reservationId: string, actualTokens: number): Promise<void> {
    if (!Number.isInteger(actualTokens) || actualTokens < 0) {
      throw new Error("actualTokens must be a non-negative integer");
    }

    const reservation = this.reservations.get(reservationId);
    if (!reservation) return;
    this.reservations.delete(reservationId);

    const entries = this.windows.get(reservation.key) ?? [];
    entries.push({ timestamp: Date.now(), tokens: actualTokens });
    this.windows.set(reservation.key, entries);
    this.cleanup(Date.now());
  }

  async release(reservationId: string): Promise<void> {
    this.reservations.delete(reservationId);
  }

  private cleanup(now: number): void {
    for (const [id, reservation] of this.reservations) {
      if (reservation.expiresAt <= now) this.reservations.delete(id);
    }

    const oldest = now - 86_400_000;
    for (const [key, entries] of this.windows) {
      const current = entries.filter((entry) => entry.timestamp > oldest);
      if (current.length > 0) this.windows.set(key, current);
      else this.windows.delete(key);
    }
  }
}

export class SqliteTokenQuotaStore implements TokenQuotaStore {
  private db: Database;
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;
  private readonly reservationTtlMs: number;

  private constructor(db: Database, reservationTtlMs: number) {
    this.db = db;
    this.reservationTtlMs = reservationTtlMs;
  }

  static async create(
    path = ".weysabi/quota.db",
    reservationTtlMs = 5 * 60_000
  ): Promise<SqliteTokenQuotaStore> {
    const { Database } = (await import("bun:sqlite")) as {
      Database: new (path: string) => Database;
    };
    const db = new Database(path);
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    db.run(`
      CREATE TABLE IF NOT EXISTS usage_entries (
        key TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tokens INTEGER NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        reserved_tokens INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    db.run("CREATE INDEX IF NOT EXISTS idx_usage_key_ts ON usage_entries(key, timestamp)");
    db.run("CREATE INDEX IF NOT EXISTS idx_reservations_key ON reservations(key)");
    const store = new SqliteTokenQuotaStore(db, reservationTtlMs);
    store.cleanupInterval = setInterval(() => {
      store.cleanupExpired();
    }, 60_000);
    return store;
  }

  private getNow(): number {
    return Date.now();
  }

  async reserve(
    key: string,
    estimatedTokens: number,
    config: TokenQuotaConfig
  ): Promise<QuotaReservationResult> {
    if (!Number.isInteger(estimatedTokens) || estimatedTokens < 1) {
      throw new Error("estimatedTokens must be a positive integer");
    }

    const now = this.getNow();
    this.cleanupExpired();

    const pendingStmt = this.db.query(
      "SELECT COALESCE(SUM(reserved_tokens), 0) FROM reservations WHERE key = ?"
    );
    const pendingTokens = Number(
      (pendingStmt.get(key) as Record<string, unknown>)["COALESCE(SUM(reserved_tokens), 0)"]
    );

    if (config.maxTokensPerMin !== undefined) {
      const minuteStmt = this.db.query(
        "SELECT COALESCE(SUM(tokens), 0) FROM usage_entries WHERE key = ? AND timestamp > ?"
      );
      const minuteTokens =
        Number(
          (minuteStmt.get(key, now - 60_000) as Record<string, unknown>)["COALESCE(SUM(tokens), 0)"]
        ) + pendingTokens;
      if (minuteTokens + estimatedTokens > config.maxTokensPerMin) {
        return {
          allowed: false,
          reason: `Token quota exceeded: ${minuteTokens}/${config.maxTokensPerMin} per minute`,
        };
      }
    }

    if (config.maxTokensPerDay !== undefined) {
      const dayStmt = this.db.query(
        "SELECT COALESCE(SUM(tokens), 0) FROM usage_entries WHERE key = ? AND timestamp > ?"
      );
      const dayTokens =
        Number(
          (dayStmt.get(key, now - 86_400_000) as Record<string, unknown>)[
            "COALESCE(SUM(tokens), 0)"
          ]
        ) + pendingTokens;
      if (dayTokens + estimatedTokens > config.maxTokensPerDay) {
        return {
          allowed: false,
          reason: `Token quota exceeded: ${dayTokens}/${config.maxTokensPerDay} per day`,
        };
      }
    }

    const id = crypto.randomUUID();
    const insertStmt = this.db.query(
      "INSERT INTO reservations (id, key, reserved_tokens, expires_at) VALUES (?, ?, ?, ?)"
    );
    insertStmt.run(id, key, estimatedTokens, now + this.reservationTtlMs);

    return {
      allowed: true,
      reservation: { id, key, reservedTokens: estimatedTokens },
    };
  }

  async commit(reservationId: string, actualTokens: number): Promise<void> {
    if (!Number.isInteger(actualTokens) || actualTokens < 0) {
      throw new Error("actualTokens must be a non-negative integer");
    }

    const getStmt = this.db.query("SELECT key FROM reservations WHERE id = ?");
    const row = getStmt.get(reservationId) as { key: string } | null;
    if (!row) return;

    this.db.run("DELETE FROM reservations WHERE id = ?", [reservationId]);
    this.db.run("INSERT INTO usage_entries (key, timestamp, tokens) VALUES (?, ?, ?)", [
      row.key,
      Date.now(),
      actualTokens,
    ]);
  }

  async release(reservationId: string): Promise<void> {
    this.db.run("DELETE FROM reservations WHERE id = ?", [reservationId]);
  }

  private cleanupExpired(): void {
    const now = this.getNow();
    this.db.run("DELETE FROM reservations WHERE expires_at <= ?", [now]);
    this.db.run("DELETE FROM usage_entries WHERE timestamp <= ?", [now - 86_400_000]);
  }

  close(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.db.close();
  }
}

function extractApiKey(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const token = auth.replace(/^Bearer\s*/i, "").trim();
  if (!token) return null;
  return token;
}

export async function fingerprintApiKey(apiKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fingerprintRequestApiKey(req: Request): Promise<string | null> {
  const apiKey = extractApiKey(req);
  return apiKey ? fingerprintApiKey(apiKey) : null;
}
