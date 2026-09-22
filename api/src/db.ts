import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

const migrations = [
  readFileSync(new URL("./migrations/001.sql", import.meta.url), "utf8"),
  readFileSync(new URL("./migrations/002-device-sessions.sql", import.meta.url), "utf8"),
];

export function createDatabase(path = "tabsync.sqlite"): Database {
  const database = new Database(path, { create: true, strict: true });
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") database.exec("PRAGMA journal_mode = WAL");

  const hasMigrations = database
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!hasMigrations) database.exec(migrations[0]!);

  const appliedVersions = new Set(
    (database.query("SELECT version FROM schema_migrations").all() as Array<{ version: number }>)
      .map(({ version }) => version),
  );
  if (!appliedVersions.has(2)) database.exec(migrations[1]!);
  return database;
}
