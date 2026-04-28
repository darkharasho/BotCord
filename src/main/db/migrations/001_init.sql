CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  content TEXT,
  embed_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_drafts_updated ON drafts(updated_at DESC);

CREATE TABLE scheduled_posts (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  content TEXT,
  embed_json TEXT,
  scheduled_for INTEGER NOT NULL,
  status TEXT NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX idx_scheduled_status_time ON scheduled_posts(status, scheduled_for);

CREATE TABLE prefs (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- schema_version table is created by the migration runner.
