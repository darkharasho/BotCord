export type Migration = { version: number; sql: string };

const M001_INIT = `
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
`;

const M002_AUTONOMY = `
CREATE TABLE autonomy_guild_config (
  guild_id        TEXT PRIMARY KEY,
  enabled         INTEGER NOT NULL DEFAULT 0,
  channel_ids     TEXT    NOT NULL DEFAULT '[]',
  context_size    INTEGER NOT NULL DEFAULT 20,
  system_prompt   TEXT,
  cooldown_ms     INTEGER NOT NULL DEFAULT 5000,
  updated_at      INTEGER NOT NULL
);
`;

const M003_DMS = `
CREATE TABLE dm_channels (
  channel_id           TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  user_username        TEXT NOT NULL,
  user_global_name     TEXT,
  user_avatar          TEXT,
  last_message_id      TEXT,
  last_message_preview TEXT,
  inert                INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX idx_dm_channels_user ON dm_channels(user_id);
CREATE INDEX idx_dm_channels_updated ON dm_channels(updated_at DESC);
`;

export const MIGRATIONS: ReadonlyArray<Migration> = [
  { version: 1, sql: M001_INIT },
  { version: 2, sql: M002_AUTONOMY },
  { version: 3, sql: M003_DMS },
];
