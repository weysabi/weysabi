import type postgres from "postgres";
import { generateId } from "../utils";
import type { SessionInfo, StoredMessage, StoreInterface } from "./types";

export class PgSessionStore implements StoreInterface {
  private sql: postgres.Sql;

  constructor(sql: postgres.Sql) {
    this.sql = sql;
    this.initSchema();
  }

  private async initSchema(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        system TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        message_count INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0
      )
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tokens INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session
      ON chat_messages(session_id, created_at)
    `;
  }

  async createSession(id?: string, system?: string): Promise<SessionInfo> {
    id = id ?? generateId(16);
    const now = new Date();
    await this.sql`
      INSERT INTO chat_sessions (id, system, created_at, updated_at)
      VALUES (${id}, ${system ?? null}, ${now}, ${now})
    `;
    return {
      id,
      system,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      messageCount: 0,
      totalTokens: 0,
    };
  }

  async getSession(sessionId: string): Promise<SessionInfo | null> {
    const rows = await this.sql<Array<Record<string, unknown>>>`
      SELECT id, system, created_at, updated_at, message_count, total_tokens
      FROM chat_sessions WHERE id = ${sessionId}
    `;
    if (rows.length === 0) return null;
    const r = rows[0]!;
    return {
      id: r.id as string,
      system: r.system as string | undefined,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      messageCount: Number(r.message_count),
      totalTokens: Number(r.total_tokens),
    };
  }

  async getOrCreateSession(sessionId: string, system?: string): Promise<SessionInfo> {
    const existing = await this.getSession(sessionId);
    if (existing) {
      if (system && existing.system !== system) {
        await this.sql`
          UPDATE chat_sessions SET system = ${system}, updated_at = NOW() WHERE id = ${sessionId}
        `;
      }
      return { ...existing, system: system ?? existing.system };
    }
    return this.createSession(sessionId, system);
  }

  async updateSessionSystem(sessionId: string, system: string): Promise<void> {
    await this.sql`
      UPDATE chat_sessions SET system = ${system}, updated_at = NOW() WHERE id = ${sessionId}
    `;
  }

  async addMessage(
    sessionId: string,
    role: "system" | "user" | "assistant",
    content: string,
    tokens: number
  ): Promise<StoredMessage> {
    const id = generateId(16);
    const now = new Date();
    await this.sql`
      INSERT INTO chat_messages (id, session_id, role, content, tokens, created_at)
      VALUES (${id}, ${sessionId}, ${role}, ${content}, ${tokens}, ${now})
    `;
    await this.sql`
      UPDATE chat_sessions
      SET message_count = message_count + 1, total_tokens = total_tokens + ${tokens}, updated_at = ${now}
      WHERE id = ${sessionId}
    `;
    return { id, sessionId, role, content, tokens, createdAt: now.toISOString() };
  }

  async getHistory(sessionId: string): Promise<StoredMessage[]> {
    type Row = {
      id: string;
      session_id: string;
      role: string;
      content: string;
      tokens: number;
      created_at: string;
    };
    const rows = await this.sql<Row[]>`
      SELECT id, session_id, role, content, tokens, created_at
      FROM chat_messages WHERE session_id = ${sessionId}
      ORDER BY created_at ASC
    `;
    return rows.map((r) => ({
      id: r.id as string,
      sessionId: r.session_id as string,
      role: r.role as "system" | "user" | "assistant",
      content: r.content as string,
      tokens: Number(r.tokens),
      createdAt: r.created_at as string,
    }));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.sql`DELETE FROM chat_messages WHERE session_id = ${sessionId}`;
    await this.sql`DELETE FROM chat_sessions WHERE id = ${sessionId}`;
  }

  async listSessions(limit = 50, offset = 0): Promise<SessionInfo[]> {
    type Row = {
      id: string;
      system: string | null;
      created_at: string;
      updated_at: string;
      message_count: number;
      total_tokens: number;
    };
    const rows = await this.sql<Row[]>`
      SELECT id, system, created_at, updated_at, message_count, total_tokens
      FROM chat_sessions ORDER BY updated_at DESC LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map((r) => ({
      id: r.id as string,
      system: r.system as string | undefined,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      messageCount: Number(r.message_count),
      totalTokens: Number(r.total_tokens),
    }));
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}
