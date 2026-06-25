import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { basename, dirname, resolve } from "path";
import { mkdtempSync, rmSync } from "fs";
import { FsObjectStore, SqliteObjectStore } from "./object-store";

describe("FsObjectStore", () => {
  it("rejects keys that escape into a sibling directory", async () => {
    const baseDir = mkdtempSync("sabi-object-store-");
    try {
      const sibling = `${basename(baseDir)}-sibling`;
      const store = new FsObjectStore(baseDir);
      await expect(store.put(`../${sibling}/secret`, new Uint8Array([1]))).rejects.toThrow(
        "escapes base directory"
      );
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
      rmSync(resolve(dirname(baseDir), `${basename(baseDir)}-sibling`), {
        recursive: true,
        force: true,
      });
    }
  });
});

describe("SqliteObjectStore", () => {
  it("rejects unsafe table names", () => {
    const db = new Database(":memory:");
    try {
      expect(() => new SqliteObjectStore(db, "objects; DROP TABLE files")).toThrow(
        "Invalid SQLite object store table name"
      );
    } finally {
      db.close();
    }
  });
});
