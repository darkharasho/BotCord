import { describe, it, expect } from 'vitest';
import { openDatabase } from '../database';

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
    expect(v.v).toBe(1);
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
