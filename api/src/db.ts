import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

const initialMigration = readFileSync(new URL("./migrations/001.sql", import.meta.url), "utf8");
const deviceSessionMigration = readFileSync(new URL("./migrations/004-device-sessions.sql", import.meta.url), "utf8");

export function createDatabase(path = "tabsync.sqlite"): Database {
  const database = new Database(path, { create: true, strict: true });
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") database.exec("PRAGMA journal_mode = WAL");

  const hasMigrations = database
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!hasMigrations) database.exec(initialMigration);

  const appliedVersions = new Set(
    (database.query("SELECT version FROM schema_migrations").all() as Array<{ version: number }>)
      .map(({ version }) => version),
  );
  const hasDeviceId = (database.query("PRAGMA table_info(auth_sessions)").all() as Array<{ name: string }>)
    .some(({ name }) => name === "device_id");
  if (!appliedVersions.has(4) || !hasDeviceId) {
    database.exec("BEGIN IMMEDIATE");
    try {
      if (!hasDeviceId) database.exec(deviceSessionMigration);
      else {
        database.exec("CREATE INDEX IF NOT EXISTS auth_sessions_device_id_idx ON auth_sessions(device_id)");
        database.query("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, ?)").run(Date.now());
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  return database;
}
