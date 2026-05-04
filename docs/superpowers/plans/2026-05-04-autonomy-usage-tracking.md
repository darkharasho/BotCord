# Autonomy Usage Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture per-session token usage and cost from CDK `session.done` events, aggregate into a daily-bucket SQLite table, and surface lifetime + last-7-days totals plus a per-guild breakdown in the Autonomy settings section.

**Architecture:** A new SQLite migration adds an `autonomy_usage_daily` table keyed by `(date, guild_id, kind)`. A new repo `autonomyUsageRepo` provides upsert + read APIs. `createAutonomyModule` gains a `recordUsage` callback wired in `src/main/index.ts`; `collectText` returns the CDK session's `usage` and `costUsd` so both `runAutonomous` and `draftReply` can record once per session. A new IPC channel `autonomy.getUsageStats` joins guild names from the Discord client. A new "Usage" panel in `AutonomySection.tsx` displays totals and a per-guild table, polling every 30s.

**Tech Stack:** TypeScript, Electron (main + renderer), better-sqlite3, React, Vitest, `@claude-cdk/core`.

---

## File Structure

**Create:**
- `src/main/db/repos/autonomyUsage.ts` — usage repo (record + getStats)
- `src/main/db/repos/__tests__/autonomyUsage.test.ts` — repo tests
- `src/renderer/components/AutonomyUsagePanel.tsx` — Usage panel component
- `src/renderer/components/__tests__/AutonomyUsagePanel.test.tsx` — panel tests

**Modify:**
- `src/main/db/migrations/index.ts` — add migration v4 for `autonomy_usage_daily`
- `src/main/autonomy/index.ts` — extend `collectText` to capture usage + cost; add `recordUsage` callback to `CreateOpts`; add `guildId` to `DraftRequest`
- `src/main/autonomy/__tests__/autonomy.test.ts` — assert recordUsage invocation, error swallowing
- `src/main/index.ts` — wire `autonomyUsageRepo.recordUsage` into the module
- `src/main/ipc/autonomy.ts` — pass guildId into `draftReply`; register `autonomy.getUsageStats` handler with guild-name join
- `src/shared/ipc-contract.ts` — add `autonomy.getUsageStats` channel + types
- `src/preload/expose.ts` — expose `autonomy.getUsageStats`
- `src/renderer/components/settings/sections/AutonomySection.tsx` — render the new Usage panel below globals

---

### Task 1: DB migration for `autonomy_usage_daily`

**Files:**
- Modify: `src/main/db/migrations/index.ts`

- [ ] **Step 1: Append migration v4 at end of `src/main/db/migrations/index.ts`**

Add this constant immediately after `M003_DMS`:

```ts
const M004_AUTONOMY_USAGE = `
CREATE TABLE autonomy_usage_daily (
  date                   TEXT    NOT NULL,
  guild_id               TEXT    NOT NULL,
  kind                   TEXT    NOT NULL,
  input_tokens           INTEGER NOT NULL DEFAULT 0,
  output_tokens          INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd               REAL    NOT NULL DEFAULT 0,
  run_count              INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, guild_id, kind)
);
CREATE INDEX idx_autonomy_usage_daily_date ON autonomy_usage_daily(date);
`;
```

Then update the exported `MIGRATIONS` array to include it:

```ts
export const MIGRATIONS: ReadonlyArray<Migration> = [
  { version: 1, sql: M001_INIT },
  { version: 2, sql: M002_AUTONOMY },
  { version: 3, sql: M003_DMS },
  { version: 4, sql: M004_AUTONOMY_USAGE },
];
```

- [ ] **Step 2: Run existing DB tests to verify migrations still apply cleanly**

Run: `npx vitest run src/main/db`
Expected: PASS for all existing db tests.

- [ ] **Step 3: Commit**

```bash
git add src/main/db/migrations/index.ts
git commit -m "feat(autonomy): add autonomy_usage_daily migration"
```

---

### Task 2: Usage repo — write the failing tests

**Files:**
- Create: `src/main/db/repos/__tests__/autonomyUsage.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
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
```

- [ ] **Step 2: Run test file to verify all tests fail**

Run: `npx vitest run src/main/db/repos/__tests__/autonomyUsage.test.ts`
Expected: FAIL with "Cannot find module '../autonomyUsage'".

- [ ] **Step 3: Commit (failing tests checked in for traceability)**

```bash
git add src/main/db/repos/__tests__/autonomyUsage.test.ts
git commit -m "test(autonomy): failing tests for autonomy usage repo"
```

---

### Task 3: Implement `autonomyUsage.ts` repo

**Files:**
- Create: `src/main/db/repos/autonomyUsage.ts`

- [ ] **Step 1: Implement repo**

```ts
import type { Database as DB } from 'better-sqlite3';

export type UsageKind = 'autonomous' | 'draft';

export const DM_GUILD_SENTINEL = '__dm__';

export type RecordUsageEntry = {
  guildId: string | null;
  kind: UsageKind;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  costUsd: number | undefined;
  at: number;
};

export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  runCount: number;
};

export type UsageTotalsByKind = {
  autonomous: UsageTotals;
  draft: UsageTotals;
  combined: UsageTotals;
};

export type GuildUsage = {
  guildId: string;
  lifetime: UsageTotalsByKind;
  last7d: UsageTotalsByKind;
};

export type UsageStats = {
  lifetime: UsageTotalsByKind;
  last7d: UsageTotalsByKind;
  perGuild: GuildUsage[];
};

export interface AutonomyUsageRepo {
  recordUsage(entry: RecordUsageEntry): void;
  getStats(now?: Date): UsageStats;
}

type AggRow = {
  guild_id: string;
  kind: UsageKind;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  run_count: number;
};

const ZERO: UsageTotals = {
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, runCount: 0,
};

const zeroByKind = (): UsageTotalsByKind => ({
  autonomous: { ...ZERO },
  draft: { ...ZERO },
  combined: { ...ZERO },
});

const addRowInto = (totals: UsageTotalsByKind, r: AggRow): void => {
  const t: UsageTotals = {
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheCreationTokens: r.cache_creation_tokens,
    costUsd: r.cost_usd,
    runCount: r.run_count,
  };
  const dst = totals[r.kind];
  dst.inputTokens += t.inputTokens;
  dst.outputTokens += t.outputTokens;
  dst.cacheReadTokens += t.cacheReadTokens;
  dst.cacheCreationTokens += t.cacheCreationTokens;
  dst.costUsd += t.costUsd;
  dst.runCount += t.runCount;
  const c = totals.combined;
  c.inputTokens += t.inputTokens;
  c.outputTokens += t.outputTokens;
  c.cacheReadTokens += t.cacheReadTokens;
  c.cacheCreationTokens += t.cacheCreationTokens;
  c.costUsd += t.costUsd;
  c.runCount += t.runCount;
};

const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function createAutonomyUsageRepo(db: DB): AutonomyUsageRepo {
  const upsertStmt = db.prepare(`
    INSERT INTO autonomy_usage_daily
      (date, guild_id, kind, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, run_count)
    VALUES
      (@date, @guild_id, @kind, @input_tokens, @output_tokens, @cache_read_tokens, @cache_creation_tokens, @cost_usd, 1)
    ON CONFLICT(date, guild_id, kind) DO UPDATE SET
      input_tokens          = input_tokens          + excluded.input_tokens,
      output_tokens         = output_tokens         + excluded.output_tokens,
      cache_read_tokens     = cache_read_tokens     + excluded.cache_read_tokens,
      cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
      cost_usd              = cost_usd              + excluded.cost_usd,
      run_count             = run_count             + 1
  `);

  const lifetimeStmt = db.prepare(`
    SELECT guild_id, kind,
           SUM(input_tokens) AS input_tokens,
           SUM(output_tokens) AS output_tokens,
           SUM(cache_read_tokens) AS cache_read_tokens,
           SUM(cache_creation_tokens) AS cache_creation_tokens,
           SUM(cost_usd) AS cost_usd,
           SUM(run_count) AS run_count
    FROM autonomy_usage_daily
    GROUP BY guild_id, kind
  `);

  const windowStmt = db.prepare(`
    SELECT guild_id, kind,
           SUM(input_tokens) AS input_tokens,
           SUM(output_tokens) AS output_tokens,
           SUM(cache_read_tokens) AS cache_read_tokens,
           SUM(cache_creation_tokens) AS cache_creation_tokens,
           SUM(cost_usd) AS cost_usd,
           SUM(run_count) AS run_count
    FROM autonomy_usage_daily
    WHERE date >= @from_date
    GROUP BY guild_id, kind
  `);

  return {
    recordUsage(entry) {
      const guildId = entry.guildId ?? DM_GUILD_SENTINEL;
      upsertStmt.run({
        date: isoDate(entry.at),
        guild_id: guildId,
        kind: entry.kind,
        input_tokens: entry.usage.inputTokens | 0,
        output_tokens: entry.usage.outputTokens | 0,
        cache_read_tokens: (entry.usage.cacheReadTokens ?? 0) | 0,
        cache_creation_tokens: (entry.usage.cacheCreationTokens ?? 0) | 0,
        cost_usd: typeof entry.costUsd === 'number' ? entry.costUsd : 0,
      });
    },

    getStats(now = new Date()) {
      const lifetime = zeroByKind();
      const last7d = zeroByKind();
      const perGuildLifetime = new Map<string, UsageTotalsByKind>();
      const perGuildLast7d = new Map<string, UsageTotalsByKind>();

      for (const r of lifetimeStmt.all() as AggRow[]) {
        addRowInto(lifetime, r);
        let g = perGuildLifetime.get(r.guild_id);
        if (!g) { g = zeroByKind(); perGuildLifetime.set(r.guild_id, g); }
        addRowInto(g, r);
      }

      // Window: include rows with date >= today_utc - 6 days (7 days inclusive of today).
      const fromMs = now.getTime() - 6 * 24 * 60 * 60 * 1000;
      const fromDate = isoDate(fromMs);
      for (const r of windowStmt.all({ from_date: fromDate }) as AggRow[]) {
        addRowInto(last7d, r);
        let g = perGuildLast7d.get(r.guild_id);
        if (!g) { g = zeroByKind(); perGuildLast7d.set(r.guild_id, g); }
        addRowInto(g, r);
      }

      const perGuild: GuildUsage[] = Array.from(perGuildLifetime.entries()).map(([guildId, lifetimeForGuild]) => ({
        guildId,
        lifetime: lifetimeForGuild,
        last7d: perGuildLast7d.get(guildId) ?? zeroByKind(),
      }));
      perGuild.sort((a, b) => {
        const c = b.lifetime.combined.costUsd - a.lifetime.combined.costUsd;
        if (c !== 0) return c;
        const tokensA = a.lifetime.combined.inputTokens + a.lifetime.combined.outputTokens;
        const tokensB = b.lifetime.combined.inputTokens + b.lifetime.combined.outputTokens;
        return tokensB - tokensA;
      });

      return { lifetime, last7d, perGuild };
    },
  };
}
```

- [ ] **Step 2: Run repo tests to verify all pass**

Run: `npx vitest run src/main/db/repos/__tests__/autonomyUsage.test.ts`
Expected: PASS for all 8 tests.

- [ ] **Step 3: Commit**

```bash
git add src/main/db/repos/autonomyUsage.ts
git commit -m "feat(autonomy): autonomy usage repo with daily-bucket aggregation"
```

---

### Task 4: Extend `collectText` and add `recordUsage` callback to autonomy module — failing tests

**Files:**
- Modify: `src/main/autonomy/__tests__/autonomy.test.ts`

- [ ] **Step 1: Add new tests at the end of the existing `describe('createAutonomyModule', ...)` block**

```ts
  it('invokes recordUsage with autonomous kind and guildId on a successful run', async () => {
    const recordUsage = vi.fn();
    const host: AutonomyHost = {
      detect: async () => ({ found: true }),
      startSession: async () => ({
        send: () => (async function* () {
          yield { type: 'assistant.text_delta', delta: 'hi' } as CDKEvent;
          yield {
            type: 'session.done',
            stopReason: 'end_turn',
            usage: { inputTokens: 12, outputTokens: 7, cacheReadTokens: 2, cacheCreationTokens: 1 },
            costUsd: 0.0042,
          } as unknown as CDKEvent;
        })(),
        abort: async () => {},
        close: async () => {},
      }),
    };
    const mod = createAutonomyModule({
      host,
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
      recordUsage,
    });
    const res = await mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(true);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    const arg = recordUsage.mock.calls[0]![0];
    expect(arg.kind).toBe('autonomous');
    expect(arg.guildId).toBe('g');
    expect(arg.usage).toEqual({ inputTokens: 12, outputTokens: 7, cacheReadTokens: 2, cacheCreationTokens: 1 });
    expect(arg.costUsd).toBeCloseTo(0.0042);
    expect(typeof arg.at).toBe('number');
  });

  it('invokes recordUsage with draft kind and propagates guildId from DraftRequest', async () => {
    const recordUsage = vi.fn();
    const host: AutonomyHost = {
      detect: async () => ({ found: true }),
      startSession: async () => ({
        send: () => (async function* () {
          yield { type: 'assistant.text_delta', delta: 'ok' } as CDKEvent;
          yield {
            type: 'session.done',
            stopReason: 'end_turn',
            usage: { inputTokens: 4, outputTokens: 2 },
            costUsd: 0.001,
          } as unknown as CDKEvent;
        })(),
        abort: async () => {},
        close: async () => {},
      }),
    };
    const mod = createAutonomyModule({
      host,
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
      recordUsage,
    });
    const res = await mod.draftReply({ requestId: 'r', guildId: 'g42', channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(true);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    const arg = recordUsage.mock.calls[0]![0];
    expect(arg.kind).toBe('draft');
    expect(arg.guildId).toBe('g42');
  });

  it('invokes recordUsage with null guildId for DM drafts', async () => {
    const recordUsage = vi.fn();
    const host: AutonomyHost = {
      detect: async () => ({ found: true }),
      startSession: async () => ({
        send: () => (async function* () {
          yield { type: 'assistant.text_delta', delta: 'ok' } as CDKEvent;
          yield { type: 'session.done', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } } as unknown as CDKEvent;
        })(),
        abort: async () => {},
        close: async () => {},
      }),
    };
    const mod = createAutonomyModule({
      host,
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
      recordUsage,
    });
    const res = await mod.draftReply({ requestId: 'r', guildId: null, channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(true);
    expect(recordUsage.mock.calls[0]![0].guildId).toBeNull();
  });

  it('does not call recordUsage when the host throws before session.done', async () => {
    const recordUsage = vi.fn();
    const host: AutonomyHost = {
      detect: async () => ({ found: true }),
      startSession: async () => { throw new Error('host kaboom'); },
    };
    const mod = createAutonomyModule({
      host,
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
      recordUsage,
    });
    const res = await mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(false);
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('swallows errors thrown by recordUsage and still returns text', async () => {
    const recordUsage = vi.fn(() => { throw new Error('disk full'); });
    const mod = createAutonomyModule({
      host: fakeHost(['hi']),
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
      recordUsage,
    });
    const res = await mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(true);
    expect(recordUsage).toHaveBeenCalledTimes(1);
  });
```

You will need to add `guildId` to the `mod.draftReply(...)` call in the existing first test as well, to keep the type checker happy. Replace the existing `mod.draftReply({ ... })` call (the one in the very first test of this file) with:

```ts
    const res = await mod.draftReply({
      requestId: 'r1',
      guildId: 'g',
      channelMeta: fakeChannelMeta,
      history,
      target,
    });
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npx vitest run src/main/autonomy/__tests__/autonomy.test.ts`
Expected: FAIL — `recordUsage` does not exist on `CreateOpts`; `guildId` does not exist on `DraftRequest`.

- [ ] **Step 3: Commit (failing)**

```bash
git add src/main/autonomy/__tests__/autonomy.test.ts
git commit -m "test(autonomy): failing tests for recordUsage callback wiring"
```

---

### Task 5: Implement `recordUsage` callback in autonomy module

**Files:**
- Modify: `src/main/autonomy/index.ts`

- [ ] **Step 1: Add `guildId` field to `DraftRequest` and update `collectText` and `CreateOpts`**

Find the `DraftRequest` type near the top of the file and add `guildId: string | null`:

```ts
export type DraftRequest = {
  requestId: string;
  guildId: string | null;
  channelMeta: { guildName: string; channelName: string; channelTopic: string | null };
  history: ChannelHistoryEntry[];
  target: ChannelHistoryEntry & { id: string };
};
```

Add a `RecordUsage` type and an optional callback to `CreateOpts`. After the `AutonomyEvents` type and above `CreateOpts`:

```ts
export type RecordUsageEntry = {
  guildId: string | null;
  kind: 'autonomous' | 'draft';
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  costUsd: number | undefined;
  at: number;
};
export type RecordUsage = (entry: RecordUsageEntry) => void;
```

Add `recordUsage?: RecordUsage` to `CreateOpts`:

```ts
type CreateOpts = {
  host: AutonomyHost;
  globalConfig: () => GlobalAutonomyConfig;
  guildConfig: (guildId: string) => GuildAutonomyConfig;
  cwd: string;
  events: AutonomyEvents;
  now?: () => number;
  pollMs?: number;
  recordUsage?: RecordUsage;
};
```

Modify `collectText` to also capture `usage` and `costUsd` from `session.done`:

```ts
const collectText = async (
  session: AutonomySession,
  prompt: string,
  onDelta?: (delta: string) => void,
): Promise<{
  text: string;
  stopReason: string | undefined;
  usage: RecordUsageEntry['usage'] | undefined;
  costUsd: number | undefined;
}> => {
  let text = '';
  let stopReason: string | undefined;
  let usage: RecordUsageEntry['usage'] | undefined;
  let costUsd: number | undefined;
  for await (const ev of session.send(prompt) as AsyncIterable<CDKEvent>) {
    if (ev.type === 'assistant.text_delta') {
      text += ev.delta;
      onDelta?.(ev.delta);
    } else if (ev.type === 'session.done') {
      stopReason = ev.stopReason;
      const e = ev as unknown as { usage?: RecordUsageEntry['usage']; costUsd?: number };
      if (e.usage) usage = e.usage;
      if (typeof e.costUsd === 'number') costUsd = e.costUsd;
    }
  }
  return { text, stopReason, usage, costUsd };
};
```

- [ ] **Step 2: Add a `safeRecord` helper and call it from `processItem` and `draftReply`**

Inside `createAutonomyModule`, after the `now` and `pollMs` setup, add:

```ts
  const safeRecord = (kind: 'autonomous' | 'draft', guildId: string | null, usage: RecordUsageEntry['usage'] | undefined, costUsd: number | undefined): void => {
    if (!opts.recordUsage || !usage) return;
    try {
      opts.recordUsage({ kind, guildId, usage, costUsd, at: now() });
    } catch {
      // Accounting failures must never break a generation.
    }
  };
```

Update `processItem` to capture and record on success:

```ts
  const processItem = async (item: QueueItem): Promise<RunAutonomousResult> => {
    const { req } = item;
    const sysPrompt = resolveSystemPrompt(req.guildId);
    const prompt = buildPrompt({
      systemPrompt: sysPrompt,
      channelMeta: req.channelMeta,
      history: req.history,
      target: req.target,
    });

    let session: AutonomySession;
    try {
      const model = opts.globalConfig().model;
      session = await opts.host.startSession({ cwd: opts.cwd, ...(model ? { model } : {}) });
    } catch (e) {
      return { ok: false, reason: 'host-error', message: e instanceof Error ? e.message : String(e) };
    }
    channelSessions.set(req.channelId, session);
    try {
      const { text, usage, costUsd } = await collectText(session, prompt);
      safeRecord('autonomous', req.guildId, usage, costUsd);
      const cleaned = postProcess(text);
      if (!cleaned) return { ok: false, reason: 'empty-output' };
      return { ok: true, text: cleaned };
    } catch (e) {
      return { ok: false, reason: 'host-error', message: e instanceof Error ? e.message : String(e) };
    } finally {
      channelSessions.delete(req.channelId);
      try { await session.close(); } catch { /* ignore */ }
    }
  };
```

Update `draftReply` similarly. Replace the existing draftReply implementation with:

```ts
    async draftReply(req) {
      const sysPrompt = resolveSystemPrompt(req.guildId);
      const inputs: PromptInputs = {
        systemPrompt: sysPrompt,
        channelMeta: req.channelMeta,
        history: req.history,
        target: req.target,
      };
      const prompt = buildPrompt(inputs);

      let session: AutonomySession;
      try {
        const model = opts.globalConfig().model;
        session = await opts.host.startSession({ cwd: opts.cwd, ...(model ? { model } : {}) });
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      draftSessions.set(req.requestId, session);
      try {
        const { text, stopReason, usage, costUsd } = await collectText(session, prompt, (d) => opts.events.onDelta(req.requestId, d));
        safeRecord('draft', req.guildId, usage, costUsd);
        opts.events.onDone(req.requestId, text, stopReason);
        return { ok: true, text, stopReason };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      } finally {
        draftSessions.delete(req.requestId);
        try { await session.close(); } catch { /* ignore */ }
      }
    },
```

Note: `resolveSystemPrompt` previously took `null` for drafts. Update its call site to pass `req.guildId` (so guild-specific prompts apply to drafts too — this is a tiny improvement consistent with the spec's "single capture point" goal). The function signature already accepts `string | null`, so no further changes needed.

- [ ] **Step 3: Run autonomy module tests to verify all pass**

Run: `npx vitest run src/main/autonomy/__tests__/autonomy.test.ts`
Expected: PASS for all tests (existing + new).

- [ ] **Step 4: Commit**

```bash
git add src/main/autonomy/index.ts
git commit -m "feat(autonomy): capture token usage from session.done and record per run"
```

---

### Task 6: Wire repo into main process

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc/autonomy.ts`

- [ ] **Step 1: Construct usage repo and pass `recordUsage` into the autonomy module**

In `src/main/index.ts`, add the import near the other repo imports:

```ts
import { createAutonomyUsageRepo } from './db/repos/autonomyUsage';
```

Just before the `createAutonomyModule({ ... })` call, instantiate the repo:

```ts
const autonomyUsageRepo = createAutonomyUsageRepo(db);
```

Add `recordUsage` to the module options:

```ts
const autonomy = createAutonomyModule({
  host,
  globalConfig: () => ({
    // …existing fields unchanged
  }),
  guildConfig: (guildId) => autonomyDbRepo.getGuildConfig(guildId),
  cwd: cdkScratch,
  events: {
    onDelta: (requestId, delta) => broadcast(AUTONOMY_DRAFT_DELTA_CHANNEL, { requestId, delta }),
    onDone: (requestId, text, stopReason) => broadcast(AUTONOMY_DRAFT_DONE_CHANNEL, { requestId, text, stopReason }),
  },
  recordUsage: (entry) => autonomyUsageRepo.recordUsage(entry),
});
```

Pass the repo into `registerAllIpc` so the IPC layer can read stats. Update the call:

```ts
registerAllIpc({ vault, manager, db, dmRepo, autonomy, host, scratchDir: cdkScratch });
```

This call already passes `db`, so the IPC layer will construct the read-only repo locally — no signature change needed here.

- [ ] **Step 2: Update `src/main/ipc/autonomy.ts` to pass `guildId` into draftReply**

Replace the body of the `autonomy.draftReply` IPC handler's inner async block. Specifically the `await autonomy.draftReply({ ... })` call, to include `guildId`:

```ts
await autonomy.draftReply({
  requestId,
  guildId: triggerMsg.guildId ?? null,
  channelMeta,
  history,
  target: {
    id: triggerMsg.id,
    authorId: triggerMsg.author.id,
    authorDisplayName: triggerMsg.member?.displayName ?? triggerMsg.author.globalName ?? triggerMsg.author.username,
    authorUsername: triggerMsg.author.username,
    isBot: triggerMsg.author.bot ?? false,
    createdAt: triggerMsg.createdTimestamp,
    content: target.content,
  },
});
```

- [ ] **Step 3: Run all autonomy + ipc tests**

Run: `npx vitest run src/main/autonomy src/main/ipc src/main/db`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/main/ipc/autonomy.ts
git commit -m "feat(autonomy): wire usage repo + guildId into draftReply"
```

---

### Task 7: Add `autonomy.getUsageStats` IPC channel

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/expose.ts`
- Modify: `src/main/ipc/autonomy.ts`

- [ ] **Step 1: Add types and channel constant in `src/shared/ipc-contract.ts`**

Add the following exported types near other autonomy types (placement: alongside `GlobalAutonomyConfig` re-exports or wherever autonomy-related shared types live; if none, place above the `BotcordApi` interface):

```ts
export type AutonomyUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  runCount: number;
};

export type AutonomyUsageTotalsByKind = {
  autonomous: AutonomyUsageTotals;
  draft: AutonomyUsageTotals;
  combined: AutonomyUsageTotals;
};

export type AutonomyGuildUsageView = {
  guildId: string;       // raw id, '__dm__' for DMs
  guildName: string;     // resolved display name
  lifetime: AutonomyUsageTotalsByKind;
  last7d: AutonomyUsageTotalsByKind;
};

export type AutonomyUsageStatsView = {
  lifetime: AutonomyUsageTotalsByKind;
  last7d: AutonomyUsageTotalsByKind;
  perGuild: AutonomyGuildUsageView[];
};
```

Inside the `BotcordApi.autonomy` interface (next to `getGlobalConfig` etc.), add:

```ts
getUsageStats(): Promise<Result<AutonomyUsageStatsView>>;
```

In the `IPC_CHANNELS` const, alongside other `'autonomy.*'` keys, add:

```ts
'autonomy.getUsageStats': 'autonomy.getUsageStats',
```

- [ ] **Step 2: Expose in `src/preload/expose.ts`**

Inside the `autonomy:` block of the preload bridge, add:

```ts
getUsageStats: () => invoke(IPC_CHANNELS['autonomy.getUsageStats']),
```

- [ ] **Step 3: Register handler in `src/main/ipc/autonomy.ts`**

Add the import at top:

```ts
import { createAutonomyUsageRepo, DM_GUILD_SENTINEL } from '../db/repos/autonomyUsage';
import type { AutonomyUsageStatsView, AutonomyGuildUsageView } from '../../shared/ipc-contract';
```

Inside `registerAutonomyHandlers`, after `const prefs = createPrefsRepo(db);`, add:

```ts
const usageRepo = createAutonomyUsageRepo(db);
```

After the existing handlers, add:

```ts
ipcMain.handle(IPC_CHANNELS['autonomy.getUsageStats'], async (): Promise<Result<AutonomyUsageStatsView>> => {
  const stats = usageRepo.getStats();
  const client = manager.getClient();
  const perGuild: AutonomyGuildUsageView[] = stats.perGuild.map(g => {
    let guildName: string;
    if (g.guildId === DM_GUILD_SENTINEL) {
      guildName = 'Direct messages';
    } else if (client) {
      guildName = client.guilds.cache.get(g.guildId)?.name ?? 'Unknown server';
    } else {
      guildName = 'Unknown server';
    }
    return { guildId: g.guildId, guildName, lifetime: g.lifetime, last7d: g.last7d };
  });
  return ok({ lifetime: stats.lifetime, last7d: stats.last7d, perGuild });
});
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: No errors. (If this command does not match the project's typecheck script, use the project's standard typecheck command, e.g. `npm run typecheck`.)

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/expose.ts src/main/ipc/autonomy.ts
git commit -m "feat(autonomy): autonomy.getUsageStats IPC channel"
```

---

### Task 8: Renderer Usage panel — failing tests

**Files:**
- Create: `src/renderer/components/__tests__/AutonomyUsagePanel.test.tsx`

- [ ] **Step 1: Write the failing test file**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AutonomyUsagePanel } from '../AutonomyUsagePanel';
import type { AutonomyUsageStatsView } from '../../../shared/ipc-contract';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var window: any;
}

function makeStats(partial: Partial<AutonomyUsageStatsView> = {}): AutonomyUsageStatsView {
  const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, runCount: 0 };
  const empty = { autonomous: { ...zero }, draft: { ...zero }, combined: { ...zero } };
  return {
    lifetime: empty,
    last7d: empty,
    perGuild: [],
    ...partial,
  };
}

beforeEach(() => {
  // jsdom provides window; attach a botcord stub.
  (globalThis as any).window.botcord = {
    autonomy: {
      getUsageStats: vi.fn(),
    },
  };
});

describe('AutonomyUsagePanel', () => {
  it('renders empty state when no usage rows', async () => {
    (window as any).botcord.autonomy.getUsageStats.mockResolvedValue({ ok: true, data: makeStats() });
    render(<AutonomyUsagePanel />);
    await waitFor(() => expect(screen.getByText(/no autonomy usage recorded yet/i)).toBeInTheDocument());
  });

  it('renders totals and per-guild rows', async () => {
    const stats: AutonomyUsageStatsView = {
      lifetime: {
        autonomous: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.50, runCount: 5 },
        draft:      { inputTokens: 200,  outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.10, runCount: 2 },
        combined:   { inputTokens: 1200, outputTokens: 600, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.60, runCount: 7 },
      },
      last7d: {
        autonomous: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.05, runCount: 1 },
        draft:      { inputTokens: 0,   outputTokens: 0,  cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0,    runCount: 0 },
        combined:   { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.05, runCount: 1 },
      },
      perGuild: [
        {
          guildId: 'g1',
          guildName: 'Test Guild',
          lifetime: {
            autonomous: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.50, runCount: 5 },
            draft:      { inputTokens: 200,  outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.10, runCount: 2 },
            combined:   { inputTokens: 1200, outputTokens: 600, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.60, runCount: 7 },
          },
          last7d: {
            autonomous: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.05, runCount: 1 },
            draft:      { inputTokens: 0,   outputTokens: 0,  cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0,    runCount: 0 },
            combined:   { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.05, runCount: 1 },
          },
        },
      ],
    };
    (window as any).botcord.autonomy.getUsageStats.mockResolvedValue({ ok: true, data: stats });
    render(<AutonomyUsagePanel />);

    await waitFor(() => expect(screen.getByText('Test Guild')).toBeInTheDocument());
    expect(screen.getByText(/lifetime/i)).toBeInTheDocument();
    expect(screen.getByText(/last 7 days/i)).toBeInTheDocument();
    // Token formatting: 1,200 with thousands separator
    expect(screen.getAllByText(/1,200/).length).toBeGreaterThan(0);
  });

  it('formats values >= 1M with M suffix', async () => {
    const big = { inputTokens: 1_240_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, runCount: 1 };
    const stats = makeStats({
      lifetime: { autonomous: big, draft: { ...big, inputTokens: 0 }, combined: big },
    });
    (window as any).botcord.autonomy.getUsageStats.mockResolvedValue({ ok: true, data: stats });
    render(<AutonomyUsagePanel />);
    await waitFor(() => expect(screen.getAllByText(/1\.24M/).length).toBeGreaterThan(0));
  });

  it('shows error and a Retry button when getUsageStats fails', async () => {
    (window as any).botcord.autonomy.getUsageStats.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: 'boom' } });
    render(<AutonomyUsagePanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run renderer tests to verify failures**

Run: `npx vitest run src/renderer/components/__tests__/AutonomyUsagePanel.test.tsx`
Expected: FAIL with "Cannot find module '../AutonomyUsagePanel'".

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/__tests__/AutonomyUsagePanel.test.tsx
git commit -m "test(autonomy): failing tests for usage panel"
```

---

### Task 9: Implement `AutonomyUsagePanel.tsx`

**Files:**
- Create: `src/renderer/components/AutonomyUsagePanel.tsx`

- [ ] **Step 1: Implement the component**

```tsx
import { useCallback, useEffect, useState } from 'react';
import type {
  AutonomyUsageStatsView,
  AutonomyUsageTotals,
  AutonomyUsageTotalsByKind,
  AutonomyGuildUsageView,
} from '../../shared/ipc-contract';

const REFRESH_MS = 30_000;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return n.toLocaleString('en-US');
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function isEmpty(s: AutonomyUsageStatsView): boolean {
  return s.lifetime.combined.runCount === 0 && s.perGuild.length === 0;
}

function TotalsColumn({ title, totals }: { title: string; totals: AutonomyUsageTotalsByKind }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-text-muted mb-2">{title}</h4>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between"><dt className="text-text-muted">Input</dt><dd>{formatTokens(totals.combined.inputTokens)}</dd></div>
        <div className="flex justify-between"><dt className="text-text-muted">Output</dt><dd>{formatTokens(totals.combined.outputTokens)}</dd></div>
        <div className="flex justify-between"><dt className="text-text-muted">Cache</dt><dd>{formatTokens(totals.combined.cacheReadTokens)} read / {formatTokens(totals.combined.cacheCreationTokens)} written</dd></div>
        <div className="flex justify-between"><dt className="text-text-muted">Runs</dt><dd>{totals.combined.runCount.toLocaleString('en-US')}</dd></div>
        <div className="flex justify-between"><dt className="text-text-muted">Cost</dt><dd>{formatCost(totals.combined.costUsd)}</dd></div>
      </dl>
      <div className="mt-2 text-xs text-text-muted">
        auto: {totals.autonomous.runCount} runs · draft: {totals.draft.runCount} runs
      </div>
    </div>
  );
}

function GuildRow({ g }: { g: AutonomyGuildUsageView }) {
  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-4">
        <div>{g.guildName}</div>
        <div className="text-xs text-text-muted">auto {g.lifetime.autonomous.runCount} · draft {g.lifetime.draft.runCount}</div>
      </td>
      <td className="py-2 pr-4 tabular-nums">{g.last7d.combined.runCount} / {g.lifetime.combined.runCount}</td>
      <td className="py-2 pr-4 tabular-nums">{formatTokens(g.last7d.combined.inputTokens)} / {formatTokens(g.lifetime.combined.inputTokens)}</td>
      <td className="py-2 pr-4 tabular-nums">{formatTokens(g.last7d.combined.outputTokens)} / {formatTokens(g.lifetime.combined.outputTokens)}</td>
      <td className="py-2 pr-4 tabular-nums">{formatCost(g.last7d.combined.costUsd)} / {formatCost(g.lifetime.combined.costUsd)}</td>
    </tr>
  );
}

export function AutonomyUsagePanel() {
  const [stats, setStats] = useState<AutonomyUsageStatsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await window.botcord.autonomy.getUsageStats();
    if (res.ok) {
      setStats(res.data);
      setError(null);
    } else {
      setError(res.error?.message ?? 'Failed to load usage stats');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (error) {
    return (
      <div className="text-sm text-text-muted">
        <p className="text-red-400 mb-2">Couldn’t load usage: {error}</p>
        <button
          type="button"
          className="px-3 py-1 rounded border border-border hover:bg-bg-hover"
          onClick={() => void load()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!stats) return <div className="text-sm text-text-muted">Loading…</div>;

  if (isEmpty(stats)) {
    return <div className="text-sm text-text-muted">No autonomy usage recorded yet.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <TotalsColumn title="Last 7 days" totals={stats.last7d} />
        <TotalsColumn title="Lifetime" totals={stats.lifetime} />
      </div>
      <p className="text-xs text-text-muted">Cost reflects API billing; subscription users will see $0.</p>

      {stats.perGuild.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-text-muted">
              <tr className="text-left">
                <th className="py-2 pr-4 font-normal">Server</th>
                <th className="py-2 pr-4 font-normal">Runs (7d / lifetime)</th>
                <th className="py-2 pr-4 font-normal">Tokens in (7d / lifetime)</th>
                <th className="py-2 pr-4 font-normal">Tokens out (7d / lifetime)</th>
                <th className="py-2 pr-4 font-normal">Cost (7d / lifetime)</th>
              </tr>
            </thead>
            <tbody>
              {stats.perGuild.map(g => <GuildRow key={g.guildId} g={g} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run panel tests to verify all pass**

Run: `npx vitest run src/renderer/components/__tests__/AutonomyUsagePanel.test.tsx`
Expected: PASS for all 4 tests.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/AutonomyUsagePanel.tsx
git commit -m "feat(autonomy): autonomy usage panel UI"
```

---

### Task 10: Render the panel in `AutonomySection`

**Files:**
- Modify: `src/renderer/components/settings/sections/AutonomySection.tsx`

- [ ] **Step 1: Edit the section component**

Replace the file contents with:

```tsx
import { GlobalAutonomySettings } from '../../GlobalAutonomySettings';
import { AutonomyUsagePanel } from '../../AutonomyUsagePanel';
import { SectionHeader } from './AccountSection';

export function AutonomySection() {
  return (
    <div className="max-w-3xl space-y-8">
      <SectionHeader title="Autonomy" subtitle="Global defaults for autonomous bot replies. Per-server overrides live in the Servers section." />
      <div className="rounded-xl border border-border bg-bg-input p-5">
        <GlobalAutonomySettings />
      </div>
      <div className="rounded-xl border border-border bg-bg-input p-5">
        <h3 className="text-base font-semibold mb-4">Usage</h3>
        <AutonomyUsagePanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: PASS for all tests.

- [ ] **Step 3: Build to confirm renderer compiles**

Run: `npm run build` (or whatever the project's build command is — check `package.json` scripts).
Expected: Successful build.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/settings/sections/AutonomySection.tsx
git commit -m "feat(autonomy): render usage panel inside autonomy settings"
```

---

### Task 11: Manual smoke test

**Files:** none

- [ ] **Step 1: Start the dev app**

Run: `npm run dev` (or the project's standard dev command).

- [ ] **Step 2: Trigger an autonomous run or a draft reply**

In a server where autonomy is enabled, post a message that triggers a run, OR right-click a message and pick "Generate reply with Claude". Confirm it streams text into the composer / posts a reply as before.

- [ ] **Step 3: Open Settings → Autonomy and verify the Usage panel**

Expected:
- "Last 7 days" and "Lifetime" columns populated.
- Per-guild table contains a row for the server you triggered in.
- Numbers are non-zero, formatted with thousands separators.
- After ≤ 30 seconds, a second triggered run is reflected without a manual refresh.

- [ ] **Step 4: Verify DM draft attribution**

Trigger "Generate reply with Claude" on a DM. Refresh the panel. Confirm a row labeled "Direct messages" appears.

---

## Self-review notes

- Spec sections covered:
  - Data model → Task 1.
  - Capture path / `recordUsage` callback / `collectText` extension → Tasks 4–5.
  - DB repo → Tasks 2–3.
  - Migration → Task 1.
  - IPC channel → Task 7.
  - UI → Tasks 8–10.
  - Tests at every layer → Tasks 2/4/8 (failing first), Tasks 3/5/9 (impl).
  - Manual smoke → Task 11.
- No placeholders. No "see Task N" indirection. Function and type names are stable across tasks (`createAutonomyUsageRepo`, `RecordUsageEntry`, `AutonomyUsageStatsView`, `DM_GUILD_SENTINEL`).
- Repo and module both expose `RecordUsageEntry` shape consistent with each other (same field names on both ends). Repo accepts `guildId: string | null`, persists `__dm__` for null.
