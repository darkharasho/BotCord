import { describe, it, expect } from 'vitest';
import { openDatabase } from '../database';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

describe('openDatabase', () => {
  it('applies all migrations on a fresh in-memory db', () => {
    const db = openDatabase(':memory:');
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);
    expect(names).toContain('drafts');
    expect(names).toContain('scheduled_posts');
    expect(names).toContain('prefs');
    expect(names).toContain('schema_version');
    const v = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number };
    expect(v.v).toBe(4);
  });

  it('is idempotent — second open is a no-op', async () => {
    const db = openDatabase(':memory:');
    const before = db.prepare('SELECT COUNT(*) as c FROM schema_version').get() as { c: number };
    const { applyMigrations } = await import('../database');
    applyMigrations(db);
    const after = db.prepare('SELECT COUNT(*) as c FROM schema_version').get() as { c: number };
    expect(after.c).toBe(before.c);
  });
});

describe('migration v2 — autonomy_guild_config', () => {
  it('creates the autonomy_guild_config table with expected columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'botcord-mig-'));
    const db = openDatabase(join(dir, 'test.sqlite'));
    try {
      const cols = db.prepare("PRAGMA table_info('autonomy_guild_config')").all() as Array<{ name: string }>;
      const names = cols.map(c => c.name).sort();
      expect(names).toEqual(['channel_ids', 'context_size', 'cooldown_ms', 'enabled', 'guild_id', 'system_prompt', 'updated_at']);
      const versions = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as Array<{ version: number }>;
      expect(versions.map(v => v.version)).toEqual([1, 2, 3, 4]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
