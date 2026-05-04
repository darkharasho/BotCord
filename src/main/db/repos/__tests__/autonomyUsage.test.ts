import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { applyMigrations } from '../../database';
import { createAutonomyUsageRepo } from '../autonomyUsage';

function fresh(): DB {
  const db = new Database(':memory:');
  applyMigrations(db);
  return db;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

describe('autonomy usage repo', () => {
  let db: DB;
  beforeEach(() => { db = fresh(); });

  it('records a single autonomous run', () => {
    const repo = createAutonomyUsageRepo(db);
    const at = Date.UTC(2026, 4, 4, 12, 0, 0);
    repo.recordUsage({
      guildId: 'g1',
      kind: 'autonomous',
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreationTokens: 5 },
      costUsd: 0.0123,
      at,
    });

    const stats = repo.getStats(new Date(at));
    expect(stats.lifetime.combined.inputTokens).toBe(100);
    expect(stats.lifetime.combined.outputTokens).toBe(50);
    expect(stats.lifetime.combined.cacheReadTokens).toBe(10);
    expect(stats.lifetime.combined.cacheCreationTokens).toBe(5);
    expect(stats.lifetime.combined.costUsd).toBeCloseTo(0.0123);
    expect(stats.lifetime.combined.runCount).toBe(1);
    expect(stats.lifetime.autonomous.runCount).toBe(1);
    expect(stats.lifetime.draft.runCount).toBe(0);
    expect(stats.perGuild).toHaveLength(1);
    expect(stats.perGuild[0]!.guildId).toBe('g1');
  });

  it('accumulates multiple runs on the same day/guild/kind via upsert', () => {
    const repo = createAutonomyUsageRepo(db);
    const at = Date.UTC(2026, 4, 4, 12, 0, 0);
    repo.recordUsage({ guildId: 'g1', kind: 'autonomous', usage: { inputTokens: 100, outputTokens: 50 }, costUsd: 0.01, at });
    repo.recordUsage({ guildId: 'g1', kind: 'autonomous', usage: { inputTokens: 200, outputTokens: 75 }, costUsd: 0.02, at });

    const stats = repo.getStats(new Date(at));
    expect(stats.lifetime.autonomous.inputTokens).toBe(300);
    expect(stats.lifetime.autonomous.outputTokens).toBe(125);
    expect(stats.lifetime.autonomous.runCount).toBe(2);
    expect(stats.lifetime.autonomous.costUsd).toBeCloseTo(0.03);
  });

  it('separates autonomous and draft kinds', () => {
    const repo = createAutonomyUsageRepo(db);
    const at = Date.UTC(2026, 4, 4, 12, 0, 0);
    repo.recordUsage({ guildId: 'g1', kind: 'autonomous', usage: { inputTokens: 100, outputTokens: 50 }, costUsd: 0.01, at });
    repo.recordUsage({ guildId: 'g1', kind: 'draft',      usage: { inputTokens: 200, outputTokens: 75 }, costUsd: 0.02, at });

    const stats = repo.getStats(new Date(at));
    expect(stats.lifetime.autonomous.inputTokens).toBe(100);
    expect(stats.lifetime.draft.inputTokens).toBe(200);
    expect(stats.lifetime.combined.inputTokens).toBe(300);
    expect(stats.lifetime.combined.runCount).toBe(2);
  });

  it('persists DM rows under the __dm__ sentinel when guildId is null', () => {
    const repo = createAutonomyUsageRepo(db);
    const at = Date.UTC(2026, 4, 4, 12, 0, 0);
    repo.recordUsage({ guildId: null, kind: 'draft', usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0, at });
    const stats = repo.getStats(new Date(at));
    expect(stats.perGuild).toHaveLength(1);
    expect(stats.perGuild[0]!.guildId).toBe('__dm__');
  });

  it('windows last-7-days correctly and excludes older rows', () => {
    const repo = createAutonomyUsageRepo(db);
    const today = Date.UTC(2026, 4, 4, 12, 0, 0);
    const tenDaysAgo = today - 10 * DAY_MS;
    const threeDaysAgo = today - 3 * DAY_MS;
    repo.recordUsage({ guildId: 'g1', kind: 'autonomous', usage: { inputTokens: 1000, outputTokens: 500 }, costUsd: 1.0, at: tenDaysAgo });
    repo.recordUsage({ guildId: 'g1', kind: 'autonomous', usage: { inputTokens: 100,  outputTokens: 50  }, costUsd: 0.1, at: threeDaysAgo });
    repo.recordUsage({ guildId: 'g1', kind: 'autonomous', usage: { inputTokens: 10,   outputTokens: 5   }, costUsd: 0.01, at: today });

    const stats = repo.getStats(new Date(today));
    expect(stats.lifetime.combined.inputTokens).toBe(1110);
    expect(stats.last7d.combined.inputTokens).toBe(110);
    expect(stats.last7d.combined.runCount).toBe(2);
  });

  it('orders perGuild by combined lifetime cost desc, ties broken by tokens desc', () => {
    const repo = createAutonomyUsageRepo(db);
    const at = Date.UTC(2026, 4, 4, 12, 0, 0);
    // g1 has highest cost
    repo.recordUsage({ guildId: 'g1', kind: 'autonomous', usage: { inputTokens: 100, outputTokens: 100 }, costUsd: 1.0, at });
    // g2 cost 0.5
    repo.recordUsage({ guildId: 'g2', kind: 'autonomous', usage: { inputTokens: 200, outputTokens: 200 }, costUsd: 0.5, at });
    // g3 cost 0.5 but more tokens than g2
    repo.recordUsage({ guildId: 'g3', kind: 'autonomous', usage: { inputTokens: 1000, outputTokens: 1000 }, costUsd: 0.5, at });

    const stats = repo.getStats(new Date(at));
    expect(stats.perGuild.map(g => g.guildId)).toEqual(['g1', 'g3', 'g2']);
  });

  it('returns zeroed totals when no rows exist', () => {
    const repo = createAutonomyUsageRepo(db);
    const stats = repo.getStats(new Date(Date.UTC(2026, 4, 4)));
    expect(stats.lifetime.combined.inputTokens).toBe(0);
    expect(stats.lifetime.combined.runCount).toBe(0);
    expect(stats.last7d.combined.inputTokens).toBe(0);
    expect(stats.perGuild).toEqual([]);
  });

  it('treats missing optional cache token fields as zero', () => {
    const repo = createAutonomyUsageRepo(db);
    const at = Date.UTC(2026, 4, 4, 12, 0, 0);
    repo.recordUsage({
      guildId: 'g1',
      kind: 'autonomous',
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd: undefined,
      at,
    });
    const stats = repo.getStats(new Date(at));
    expect(stats.lifetime.combined.cacheReadTokens).toBe(0);
    expect(stats.lifetime.combined.cacheCreationTokens).toBe(0);
    expect(stats.lifetime.combined.costUsd).toBe(0);
  });

  it('uses UTC date bucketing (verify via direct row inspection)', () => {
    const repo = createAutonomyUsageRepo(db);
    // 2026-05-04T23:30:00Z — a moment that is on different calendar dates in UTC vs many local TZs
    const at = Date.UTC(2026, 4, 4, 23, 30, 0);
    repo.recordUsage({ guildId: 'g1', kind: 'autonomous', usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0, at });
    const row = db.prepare('SELECT date FROM autonomy_usage_daily').get() as { date: string };
    expect(row.date).toBe('2026-05-04');
  });
});
