import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { applyMigrations } from '../../database';
import { createAutonomyRepo } from '../autonomy';

function fresh(): DB {
  const db = new Database(':memory:');
  applyMigrations(db);
  return db;
}

describe('autonomy repo', () => {
  let db: DB;
  beforeEach(() => { db = fresh(); });

  it('returns defaults for a guild with no row', () => {
    const repo = createAutonomyRepo(db);
    const cfg = repo.getGuildConfig('g1');
    expect(cfg).toEqual({
      guildId: 'g1', enabled: false, channelIds: [], contextSize: 20,
      systemPrompt: null, cooldownMs: 5000, updatedAt: 0,
    });
  });

  it('upserts and reads back', () => {
    const repo = createAutonomyRepo(db);
    const before = Date.now();
    repo.upsertGuildConfig('g1', { enabled: true, channelIds: ['c1', 'c2'], systemPrompt: 'be brief' });
    const cfg = repo.getGuildConfig('g1');
    expect(cfg.enabled).toBe(true);
    expect(cfg.channelIds).toEqual(['c1', 'c2']);
    expect(cfg.systemPrompt).toBe('be brief');
    expect(cfg.contextSize).toBe(20);
    expect(cfg.cooldownMs).toBe(5000);
    expect(cfg.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('partial upsert preserves untouched fields', () => {
    const repo = createAutonomyRepo(db);
    repo.upsertGuildConfig('g1', { enabled: true, channelIds: ['c1'], contextSize: 30 });
    repo.upsertGuildConfig('g1', { systemPrompt: 'updated' });
    const cfg = repo.getGuildConfig('g1');
    expect(cfg.enabled).toBe(true);
    expect(cfg.channelIds).toEqual(['c1']);
    expect(cfg.contextSize).toBe(30);
    expect(cfg.systemPrompt).toBe('updated');
  });

  it('setChannelEnabled toggles a channel id in the allowlist', () => {
    const repo = createAutonomyRepo(db);
    repo.setChannelEnabled('g1', 'c1', true);
    expect(repo.getGuildConfig('g1').channelIds).toEqual(['c1']);
    repo.setChannelEnabled('g1', 'c2', true);
    expect(repo.getGuildConfig('g1').channelIds.sort()).toEqual(['c1', 'c2']);
    repo.setChannelEnabled('g1', 'c1', false);
    expect(repo.getGuildConfig('g1').channelIds).toEqual(['c2']);
    repo.setChannelEnabled('g1', 'c1', false); // no-op
    expect(repo.getGuildConfig('g1').channelIds).toEqual(['c2']);
  });
});
