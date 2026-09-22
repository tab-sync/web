ALTER TABLE auth_sessions ADD COLUMN device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;

CREATE INDEX auth_sessions_device_id_idx ON auth_sessions(device_id);

INSERT INTO schema_migrations(version, applied_at)
VALUES (2, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
