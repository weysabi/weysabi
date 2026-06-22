import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { generateId } from "../utils";
import type { SessionInfo, StoredMessage, StoreInterface } from "./types";

export class SqliteSessionStore implements StoreInterface {
  private db: Database;

  constructor(dbPath: string) {
    const resolved = resolve(dbPath);
    const dir = dirname(resolved);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(resolved);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA synchronous = NORMAL");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        system TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tokens INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id, created_at)"
    );
    try {
      this.db.run("ALTER TABLE chat_sessions ADD COLUMN system TEXT");
    } catch {
      /* column already exists */
    }
  }

  async createSession(id?: string, system?: string): Promise<SessionInfo> {
    id = id ?? generateId(16);
    const now = new Date().toISOString();
    this.db
      .query("INSERT INTO chat_sessions (id, system, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(id, system ?? null, now, now);
    return { id, system, createdAt: now, updatedAt: now, messageCount: 0, totalTokens: 0 };
  }

  async getSession(sessionId: string): Promise<SessionInfo | null> {
    const row = this.db
      .query(
        "SELECT id, system, created_at, updated_at, message_count, total_tokens FROM chat_sessions WHERE id = ?"
      )
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      system: row.system as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      messageCount: row.message_count as number,
      totalTokens: row.total_tokens as number,
    };
  }

  async getOrCreateSession(sessionId: string, system?: string): Promise<SessionInfo> {
    const existing = await this.getSession(sessionId);
    if (existing) {
      if (system && existing.system !== system) {
        this.db
          .query("UPDATE chat_sessions SET system = ?, updated_at = ? WHERE id = ?")
          .run(system, new Date().toISOString(), sessionId);
      }
      return { ...existing, system: system ?? existing.system };
    }
    return this.createSession(sessionId, system);
  }

  async updateSessionSystem(sessionId: string, system: string): Promise<void> {
    this.db
      .query("UPDATE chat_sessions SET system = ?, updated_at = ? WHERE id = ?")
      .run(system, new Date().toISOString(), sessionId);
  }

  async addMessage(
    sessionId: string,
    role: "system" | "user" | "assistant",
    content: string,
    tokens: number
  ): Promise<StoredMessage> {
    const id = generateId(16);
    const now = new Date().toISOString();
    this.db
      .query(
        "INSERT INTO chat_messages (id, session_id, role, content, tokens, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(id, sessionId, role, content, tokens, now);
    this.db
      .query(
        "UPDATE chat_sessions SET message_count = message_count + 1, total_tokens = total_tokens + ?, updated_at = ? WHERE id = ?"
      )
      .run(tokens, now, sessionId);
    return { id, sessionId, role, content, tokens, createdAt: now };
  }

  async getHistory(sessionId: string): Promise<StoredMessage[]> {
    const rows = this.db
      .query(
        "SELECT id, session_id, role, content, tokens, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC"
      )
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      sessionId: r.session_id as string,
      role: r.role as "system" | "user" | "assistant",
      content: r.content as string,
      tokens: r.tokens as number,
      createdAt: r.created_at as string,
    }));
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.db.transaction(() => {
      this.db.run("DELETE FROM chat_messages WHERE session_id = ?", [sessionId]);
      this.db.run("DELETE FROM chat_sessions WHERE id = ?", [sessionId]);
    })();
  }

  async listSessions(limit = 50, offset = 0): Promise<SessionInfo[]> {
    const rows = this.db
      .query(
        "SELECT id, system, created_at, updated_at, message_count, total_tokens FROM chat_sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?"
      )
      .all(limit, offset) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      system: r.system as string | undefined,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      messageCount: r.message_count as number,
      totalTokens: r.total_tokens as number,
    }));
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
