CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_canonical TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE auth_sessions (
  token_hash BLOB PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  browser TEXT NOT NULL CHECK (browser IN ('chrome', 'safari')),
  platform TEXT NOT NULL CHECK (platform IN ('macos', 'ios')),
  extension_version TEXT NOT NULL,
  tabs_revision INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, installation_id)
);

CREATE INDEX devices_user_id_last_seen_idx ON devices(user_id, last_seen_at DESC);

CREATE TABLE open_tabs (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  browser_tab_id INTEGER NOT NULL,
  window_id INTEGER NOT NULL,
  tab_index INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, browser_tab_id)
);

CREATE INDEX open_tabs_device_window_idx ON open_tabs(device_id, window_id, tab_index);

CREATE TABLE history_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  browser_tab_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('committed', 'history_state', 'tab_url_change')),
  visited_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE INDEX history_entries_device_visited_idx
  ON history_entries(device_id, visited_at DESC, id DESC);

INSERT INTO schema_migrations(version, applied_at)
VALUES (1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
