import { describe, expect, it } from "bun:test";
import type postgres from "postgres";
import { PgSessionStore } from "./pg-store";

type SqlMock = postgres.Sql & {
  calls: string[];
  beginCalls: number;
  releaseSchema?: () => void;
};

function createSqlMock(blockFirstSchema = false): SqlMock {
  const calls: string[] = [];
  let firstSchema = true;

  const sql = (async (
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<Array<Record<string, unknown>>> => {
    const query = strings.join("?").replace(/\s+/gu, " ").trim();
    calls.push(query);
    if (blockFirstSchema && firstSchema && query.startsWith("CREATE TABLE")) {
      firstSchema = false;
      await new Promise<void>((resolve) => {
        sql.releaseSchema = resolve;
      });
    }
    return [];
  }) as unknown as SqlMock;

  sql.calls = calls;
  sql.beginCalls = 0;
  sql.begin = (async (callback: (transaction: postgres.TransactionSql) => Promise<unknown>) => {
    sql.beginCalls++;
    return callback(sql as unknown as postgres.TransactionSql);
  }) as postgres.Sql["begin"];
  sql.end = (async () => undefined) as postgres.Sql["end"];
  return sql;
}

describe("PgSessionStore", () => {
  it("waits for schema initialization before serving operations", async () => {
    const sql = createSqlMock(true);
    const store = new PgSessionStore(sql);

    const pending = store.getSession("session");
    await Promise.resolve();
    expect(sql.calls.filter((query) => query.startsWith("SELECT"))).toHaveLength(0);

    sql.releaseSchema?.();
    await pending;
    expect(sql.calls.filter((query) => query.startsWith("SELECT"))).toHaveLength(1);
  });

  it("records a message and session counters in one transaction", async () => {
    const sql = createSqlMock();
    const store = new PgSessionStore(sql);

    await store.addMessage("session", "user", "hello", 2);

    expect(sql.beginCalls).toBe(1);
    expect(sql.calls.some((query) => query.startsWith("INSERT INTO chat_messages"))).toBe(true);
    expect(sql.calls.some((query) => query.startsWith("UPDATE chat_sessions"))).toBe(true);
  });
});
