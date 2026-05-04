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
