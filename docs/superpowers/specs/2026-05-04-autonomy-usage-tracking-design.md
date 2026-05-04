# Autonomy usage tracking — design

## Goal

Surface how many tokens (and how much money, when applicable) BotCord's autonomy features consume, so the operator can see at a glance whether running autonomous replies is expensive and which servers drive the cost.

Both code paths through `@claude-cdk/core` are tracked:

- `runAutonomous` — fully autonomous replies triggered by `messageCreate`.
- `draftReply` — user-initiated "Generate reply with Claude" assist.

## Data model

New SQLite table aggregated by day:

```sql
CREATE TABLE autonomy_usage_daily (
  date                   TEXT NOT NULL,            -- 'YYYY-MM-DD' (UTC)
  guild_id               TEXT NOT NULL,            -- Discord guild id, or '__dm__' for DMs
  kind                   TEXT NOT NULL,            -- 'autonomous' | 'draft'
  input_tokens           INTEGER NOT NULL DEFAULT 0,
  output_tokens          INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd               REAL    NOT NULL DEFAULT 0,
  run_count              INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, guild_id, kind)
);
CREATE INDEX idx_autonomy_usage_daily_date ON autonomy_usage_daily (date);
```

Daily buckets keep the table bounded (≤ 365 × N_guilds × 2 rows per year) while supporting both rolling-window and lifetime queries cheaply.

The DM sentinel `'__dm__'` exists because `draftReply` can run from DM channels that have no `guildId`. It gets a stable label in the UI.

## Capture path

CDK already exposes per-session token usage on the `session.done` event:

```ts
{ type: 'session.done', usage: { inputTokens, outputTokens, cacheReadTokens?, cacheCreationTokens? }, costUsd?, stopReason }
```

`collectText` in `src/main/autonomy/index.ts` is the single point that consumes the CDK event stream for both `runAutonomous` and `draftReply`. We extend it to also capture `usage` and `costUsd` from `session.done`, then return them alongside `text` and `stopReason`.

`createAutonomyModule` gains an optional `recordUsage` callback in `CreateOpts`:

```ts
type RecordUsage = (entry: {
  guildId: string | null;     // null => '__dm__' sentinel
  kind: 'autonomous' | 'draft';
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number };
  costUsd: number | undefined;
  at: number;                 // ms since epoch; bucket date derived from this
}) => void;
```

`processItem` (autonomous) and `draftReply` each invoke the callback once per session in their `finally` blocks. Errors thrown by `recordUsage` are caught and logged at debug level — accounting must never break a generation.

Tests inject a fake recorder that pushes calls onto an array.

`DraftRequest` gains a `guildId: string | null` field. `RunAutonomousRequest` already carries `guildId`.

## DB repo

New file `src/main/db/repos/autonomyUsage.ts`:

```ts
export type UsageKind = 'autonomous' | 'draft';

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
  guildId: string;            // raw id, or '__dm__'
  lifetime: UsageTotalsByKind;
  last7d: UsageTotalsByKind;
};

export type UsageStats = {
  lifetime: UsageTotalsByKind;
  last7d:   UsageTotalsByKind;
  perGuild: GuildUsage[];     // sorted by combined lifetime cost desc, ties broken by combined lifetime tokens desc
};

export type RecordUsageEntry = {
  guildId: string | null;     // null persisted as '__dm__'
  kind: UsageKind;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number };
  costUsd: number | undefined;
  at: number;                 // ms since epoch; UTC date derived here
};

export const autonomyUsageRepo = {
  recordUsage(entry: RecordUsageEntry): void;   // INSERT … ON CONFLICT(date, guild_id, kind) DO UPDATE SET col = col + excluded.col
  getStats(now?: Date): UsageStats;              // two SELECTs grouped by guild_id, kind: lifetime + last-7-days window
};
```

The `ON CONFLICT … DO UPDATE` upsert lets concurrent autonomous runs aggregate without races.

`getStats` runs two SELECTs (lifetime + last 7 days) grouped by `guild_id, kind`, then assembles the structure in JS.

`date` for bucketing uses UTC: `new Date(at).toISOString().slice(0, 10)`. UTC keeps "last 7 days" stable across timezone shifts.

## Migration

New numbered migration in `src/main/db/migrations/` adds the table and index. Follow the existing migration pattern.

## IPC

Add a single read-only channel:

```ts
// src/shared/ipc-contract.ts
autonomy: {
  // … existing
  getUsageStats(): Promise<Result<UsageStatsView>>;
}
```

`UsageStatsView` is `UsageStats` with `perGuild` rows enriched by guild display name resolved in main process from the Discord client (`client.guilds.cache.get(guildId)?.name`). Unknown/left guilds get name `"Unknown server"`. The DM sentinel gets `"Direct messages"`.

```ts
type GuildUsageView = GuildUsage & { guildName: string };
type UsageStatsView = Omit<UsageStats, 'perGuild'> & { perGuild: GuildUsageView[] };
```

Exposed on the preload bridge as `window.botcord.autonomy.getUsageStats()`.

## UI

A new **Usage** section appended to `src/renderer/components/settings/sections/AutonomySection.tsx`, below the existing global controls.

Behavior:

- Loads `getUsageStats` on mount.
- Polls every 30s while the Autonomy section is mounted, so the operator sees fresh numbers without manual refresh.
- Shows a small inline error and a Retry button if the IPC call fails.
- Empty state (no rows): single muted line "No autonomy usage recorded yet."

Layout:

1. **Totals card.** Two columns: "Last 7 days" and "Lifetime". Each column shows:
   - Input tokens
   - Output tokens
   - Cache (one line, "X read / Y written")
   - Runs
   - Estimated cost (USD)
   - A small autonomous/draft split badge: "auto: 124 runs · draft: 18 runs" style.
   - Footnote (muted, once per card): "Cost reflects API billing; subscription users will see $0."

2. **Per-guild table.** Columns:
   - Server (display name; DM sentinel shown as "Direct messages")
   - Runs (7d / lifetime)
   - Tokens in (7d / lifetime)
   - Tokens out (7d / lifetime)
   - Cost (7d / lifetime)
   - Each row has a secondary line: "auto N · draft M" using lifetime counts.
   - Sorted: combined lifetime cost desc, ties broken by combined lifetime tokens desc.
   - Renders nothing if `perGuild` is empty.

Number formatting:
- Tokens: thousands separators below 1,000,000; `1.24M` style above.
- Cost: `$0.0123` for values < $0.01, otherwise two decimals (`$1.42`). Always shown, even when zero.

No reset button (per design choice — rolling window already answers "is it getting more expensive lately?").

## Testing

- **Repo tests** (`src/main/db/repos/__tests__/autonomyUsage.test.ts`):
  - upsert accumulates on the same `(date, guildId, kind)` row
  - `getStats` returns correct lifetime + last-7-days totals split by kind
  - DM sentinel rows surface under `'__dm__'`
  - perGuild ordering by combined lifetime cost desc

- **Autonomy module tests** (extend `src/main/autonomy/__tests__/autonomy.test.ts`):
  - Fake host emits `session.done` with usage + costUsd; `recordUsage` is called exactly once per `processItem` and once per `draftReply`, with the correct `kind` and `guildId`
  - Errors thrown from `recordUsage` do not propagate
  - On host error path (CDK throws before `session.done`), `recordUsage` is not called

- **IPC tests** (extend existing autonomy IPC tests if present, otherwise minimal):
  - `getUsageStats` joins guild names; unknown ids fall back to "Unknown server"

- **UI tests** (`SettingsOverlay.test.tsx` or new `AutonomySection.test.tsx`):
  - Renders totals and per-guild rows from a fixture
  - Empty state when no rows
  - Number formatting (1.24M, sub-cent cost)

## Out of scope

- Per-channel breakdown (per-guild is the actionable unit; per-channel adds noise).
- Per-run history view (debug-y; not needed for the cost question).
- Manual reset / clear (rolling window covers the "recent spike" use case).
- Backfill of historical runs (we only have data going forward).
- Multi-currency display (CDK reports USD only).
