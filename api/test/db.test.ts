import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../src/db";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function legacyDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "tabsync-migration-"));
  directories.push(directory);
  const path = join(directory, "tabsync.sqlite");
  const database = new Database(path, { create: true });
  database.exec(readFileSync(new URL("../src/migrations/001.sql", import.meta.url), "utf8"));
  database.exec("INSERT INTO schema_migrations(version, applied_at) VALUES (2, 1), (3, 1)");
  return { database, path };
}

describe("device session migration", () => {
  test("adds the column when earlier migrations already used versions 2 and 3", () => {
    const { database, path } = legacyDatabase();
    database.close();

    const migrated = createDatabase(path);
    expect((migrated.query("PRAGMA table_info(auth_sessions)").all() as Array<{ name: string }>)
      .some(({ name }) => name === "device_id")).toBe(true);
    expect((migrated.query("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>)
      .map(({ version }) => version)).toEqual([1, 2, 3, 4]);
    migrated.close();

    const reopened = createDatabase(path);
    expect((reopened.query("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 4").get() as { count: number }).count).toBe(1);
    reopened.close();
  });

  test("records version 4 when the column was already added by version 2", () => {
    const { database, path } = legacyDatabase();
    database.exec("ALTER TABLE auth_sessions ADD COLUMN device_id TEXT REFERENCES devices(id) ON DELETE SET NULL");
    database.close();

    const migrated = createDatabase(path);
    expect((migrated.query("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 4").get() as { count: number }).count).toBe(1);
    expect((migrated.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'auth_sessions_device_id_idx'").get() as { name: string }).name)
      .toBe("auth_sessions_device_id_idx");
    migrated.close();
  });
});
