# Autonomous Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an autonomous reply mode to BotCord that uses the `@claude-cdk/core` SDK to generate Discord messages when the bot is mentioned (or replied to) in opted-in channels, plus a manual "Generate reply with Claude" UI action that drafts into the existing Composer.

**Architecture:** A new main-process subsystem `src/main/autonomy/` owns a long-lived `CDKHost`, a second `messageCreate` listener, throttling, prompt assembly, and per-guild config persisted in a new SQLite table (migration v2). Three new prefs keys hold the global kill switch, default persona, and rate cap. New IPC namespace `autonomy.*` plus two broadcast event channels stream draft deltas to the renderer; the renderer exposes a guild-settings tab, an app-settings section, and a "Generate reply with Claude" message action that pipes streamed text into the Composer via a module-level event bus (matching the existing `Toaster` pattern). The autonomous path sends to Discord directly; the manual path always drafts.

**Tech Stack:** Electron 33, TypeScript 5, discord.js 14.16, better-sqlite3 11, React 18, vitest 2, `@claude-cdk/core` 0.1.

**Spec:** `docs/superpowers/specs/2026-04-29-autonomous-mode-design.md`

---

## File map

**Create:**
- `src/main/autonomy/types.ts` — shared types for the subsystem.
- `src/main/autonomy/prompt.ts` — context assembly (history fetch, formatting, system prompt).
- `src/main/autonomy/post-process.ts` — truncation, mention stripping, emptiness check.
- `src/main/autonomy/throttle.ts` — per-channel cooldown, global token bucket, in-flight set.
- `src/main/autonomy/index.ts` — module entry; constructs subsystem, registers `messageCreate` listener, exposes `draftReply`.
- `src/main/autonomy/__tests__/prompt.test.ts`
- `src/main/autonomy/__tests__/post-process.test.ts`
- `src/main/autonomy/__tests__/throttle.test.ts`
- `src/main/autonomy/__tests__/autonomy.test.ts` — integration with fake `CDKHost`.
- `src/main/db/repos/autonomy.ts`
- `src/main/db/repos/__tests__/autonomy.test.ts`
- `src/main/ipc/autonomy.ts`
- `src/renderer/components/AutonomySettingsTab.tsx` — guild-level settings panel content.
- `src/renderer/components/GlobalAutonomySettings.tsx` — app-settings section.
- `src/renderer/lib/composer-bus.ts` — module-level event bus for injecting drafts into the Composer.

**Modify:**
- `src/main/db/migrations/index.ts` — add v2 migration creating `autonomy_guild_config`.
- `src/main/db/__tests__/database.test.ts` — assert v2 applied.
- `src/main/discord/client-manager.ts` — expose `getClient()` (already present); no changes needed beyond what's there.
- `src/main/index.ts` — instantiate autonomy module after DB and manager.
- `src/main/ipc/index.ts` — register autonomy handlers; thread `AutonomyModule` through `IpcDeps`.
- `src/main/ipc/prefs.ts` — add three new keys to `VALID_KEYS`.
- `src/preload/expose.ts` — expose `botcord.autonomy.*`.
- `src/shared/ipc-contract.ts` — add `BotcordApi.autonomy`, IPC channel constants, `events.onAutonomyDraftDelta`/`onAutonomyDraftDone`.
- `src/shared/domain.ts` — add `Prefs` keys, `GuildAutonomyConfig`, `GlobalAutonomyConfig`.
- `src/renderer/lib/api.ts` — re-exports of `window.botcord.autonomy` (match existing `api` shape).
- `src/renderer/components/Composer.tsx` — subscribe to `composer-bus` to inject drafted text.
- `src/renderer/components/MessageGroup.tsx` — add "Generate reply with Claude" item to `buildMessageMenu` and the hover toolbar.
- `src/renderer/components/SettingsPanel.tsx` — add new "Autonomy" section.
- `package.json` — add `@claude-cdk/core` dependency.

---

## Task 1: Add `@claude-cdk/core` dependency and shared types

**Files:**
- Modify: `package.json`
- Modify: `src/shared/domain.ts`

- [ ] **Step 1: Install dependency**

Run:
```bash
npm install @claude-cdk/core@^0.1.0
```

Expected: `package.json` and `package-lock.json` updated; `node_modules/@claude-cdk/core/dist/index.d.ts` exists.

- [ ] **Step 2: Add domain types**

Edit `src/shared/domain.ts`. Find the existing `Prefs` type definition and extend it:

```ts
// add three new keys to the existing Prefs type
export type Prefs = {
  lastSelectedGuildId: string | null;
  lastSelectedChannelId: string | null;
  theme: 'dark';
  collapsedCategoryIds: string[];
  memberListOpen: boolean;
  channelLastSeen: Record<string, number>;
  mutedChannelIds: string[];
  giphyApiKey: string;
  autonomyGlobalEnabled: boolean;
  autonomyGlobalSystemPrompt: string;
  autonomyGlobalRateCapPerMin: number;
};

export type GuildAutonomyConfig = {
  guildId: string;
  enabled: boolean;
  channelIds: string[];
  contextSize: number;
  systemPrompt: string | null;
  cooldownMs: number;
  updatedAt: number;
};

export type GlobalAutonomyConfig = {
  enabled: boolean;
  systemPrompt: string;
  rateCapPerMin: number;
};

export const DEFAULT_GLOBAL_SYSTEM_PROMPT =
  "You are a helpful assistant participating in a Discord text channel. Reply briefly and conversationally. Stay on topic. Match the channel's tone. Use plain text — no markdown headings or code fences unless asked.";
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: Passes (these new types are not yet referenced).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/shared/domain.ts
git commit -m "feat(autonomy): add @claude-cdk/core dep and domain types"
```

---

## Task 2: SQLite migration v2 for `autonomy_guild_config`

**Files:**
- Modify: `src/main/db/migrations/index.ts`
- Test: `src/main/db/__tests__/database.test.ts`

- [ ] **Step 1: Inspect existing migration test file**

Run: `cat src/main/db/__tests__/database.test.ts` to learn the existing pattern. Adapt the new test below to match (imports, helpers).

- [ ] **Step 2: Add a failing test for v2 migration**

Append to `src/main/db/__tests__/database.test.ts`:

```ts
import { openDatabase } from '../database';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

describe('migration v2 — autonomy_guild_config', () => {
  it('creates the autonomy_guild_config table with expected columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'botcord-mig-'));
    const db = openDatabase(join(dir, 'test.sqlite'));
    try {
      const cols = db.prepare("PRAGMA table_info('autonomy_guild_config')").all() as Array<{ name: string }>;
      const names = cols.map(c => c.name).sort();
      expect(names).toEqual(['channel_ids', 'context_size', 'cooldown_ms', 'enabled', 'guild_id', 'system_prompt', 'updated_at']);
      const versions = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as Array<{ version: number }>;
      expect(versions.map(v => v.version)).toEqual([1, 2]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/main/db/__tests__/database.test.ts -t "migration v2"`
Expected: FAIL — `no such table: autonomy_guild_config`.

- [ ] **Step 4: Add migration**

Edit `src/main/db/migrations/index.ts`. After `M001_INIT`, add:

```ts
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

export const MIGRATIONS: ReadonlyArray<Migration> = [
  { version: 1, sql: M001_INIT },
  { version: 2, sql: M002_AUTONOMY },
];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/main/db/__tests__/database.test.ts -t "migration v2"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/db/migrations/index.ts src/main/db/__tests__/database.test.ts
git commit -m "feat(autonomy): migration v2 adds autonomy_guild_config table"
```

---

## Task 3: Autonomy repo (`autonomy_guild_config` CRUD)

**Files:**
- Create: `src/main/db/repos/autonomy.ts`
- Test: `src/main/db/repos/__tests__/autonomy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/db/repos/__tests__/autonomy.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/db/repos/__tests__/autonomy.test.ts`
Expected: FAIL — `Cannot find module '../autonomy'`.

- [ ] **Step 3: Implement the repo**

Create `src/main/db/repos/autonomy.ts`:

```ts
import type { Database as DB } from 'better-sqlite3';
import type { GuildAutonomyConfig } from '../../../shared/domain';

type Row = {
  guild_id: string;
  enabled: number;
  channel_ids: string;
  context_size: number;
  system_prompt: string | null;
  cooldown_ms: number;
  updated_at: number;
};

const toDomain = (r: Row): GuildAutonomyConfig => ({
  guildId: r.guild_id,
  enabled: r.enabled === 1,
  channelIds: JSON.parse(r.channel_ids) as string[],
  contextSize: r.context_size,
  systemPrompt: r.system_prompt,
  cooldownMs: r.cooldown_ms,
  updatedAt: r.updated_at,
});

const defaultsFor = (guildId: string): GuildAutonomyConfig => ({
  guildId, enabled: false, channelIds: [], contextSize: 20,
  systemPrompt: null, cooldownMs: 5000, updatedAt: 0,
});

export interface AutonomyRepo {
  getGuildConfig(guildId: string): GuildAutonomyConfig;
  upsertGuildConfig(guildId: string, partial: Partial<Omit<GuildAutonomyConfig, 'guildId' | 'updatedAt'>>): GuildAutonomyConfig;
  setChannelEnabled(guildId: string, channelId: string, enabled: boolean): GuildAutonomyConfig;
}

export function createAutonomyRepo(db: DB): AutonomyRepo {
  const getStmt = db.prepare('SELECT * FROM autonomy_guild_config WHERE guild_id=?');
  const upsertStmt = db.prepare(`
    INSERT INTO autonomy_guild_config (guild_id, enabled, channel_ids, context_size, system_prompt, cooldown_ms, updated_at)
    VALUES (@guild_id, @enabled, @channel_ids, @context_size, @system_prompt, @cooldown_ms, @updated_at)
    ON CONFLICT(guild_id) DO UPDATE SET
      enabled=excluded.enabled,
      channel_ids=excluded.channel_ids,
      context_size=excluded.context_size,
      system_prompt=excluded.system_prompt,
      cooldown_ms=excluded.cooldown_ms,
      updated_at=excluded.updated_at
  `);

  const read = (guildId: string): GuildAutonomyConfig => {
    const row = getStmt.get(guildId) as Row | undefined;
    return row ? toDomain(row) : defaultsFor(guildId);
  };

  return {
    getGuildConfig: read,

    upsertGuildConfig(guildId, partial) {
      const current = read(guildId);
      const merged: GuildAutonomyConfig = {
        ...current,
        ...partial,
        guildId,
        updatedAt: Date.now(),
      };
      upsertStmt.run({
        guild_id: merged.guildId,
        enabled: merged.enabled ? 1 : 0,
        channel_ids: JSON.stringify(merged.channelIds),
        context_size: merged.contextSize,
        system_prompt: merged.systemPrompt,
        cooldown_ms: merged.cooldownMs,
        updated_at: merged.updatedAt,
      });
      return merged;
    },

    setChannelEnabled(guildId, channelId, enabled) {
      const current = read(guildId);
      const set = new Set(current.channelIds);
      if (enabled) set.add(channelId); else set.delete(channelId);
      return this.upsertGuildConfig(guildId, { channelIds: Array.from(set) });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/main/db/repos/__tests__/autonomy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/repos/autonomy.ts src/main/db/repos/__tests__/autonomy.test.ts
git commit -m "feat(autonomy): autonomy_guild_config repo with defaults + partial upsert"
```

---

## Task 4: Subsystem types

**Files:**
- Create: `src/main/autonomy/types.ts`

This is a no-test scaffolding task — types only.

- [ ] **Step 1: Write the file**

Create `src/main/autonomy/types.ts`:

```ts
import type { CDKEvent } from '@claude-cdk/core';
import type { GuildAutonomyConfig, GlobalAutonomyConfig } from '../../shared/domain';

export type AutonomyDeps = {
  host: AutonomyHost;
  globalConfig: () => GlobalAutonomyConfig;
  guildConfig: (guildId: string) => GuildAutonomyConfig;
  now?: () => number;
};

export interface AutonomyHost {
  detect(): Promise<{ found: boolean; version?: string; reason?: string }>;
  startSession(opts: { cwd: string }): Promise<AutonomySession>;
}

export interface AutonomySession {
  send(prompt: string): AsyncIterable<CDKEvent>;
  abort(): Promise<void>;
  close(): Promise<void>;
}

export type ChannelHistoryEntry = {
  authorId: string;
  authorDisplayName: string;
  isBot: boolean;
  createdAt: number;
  content: string;
};

export type PromptInputs = {
  systemPrompt: string;
  channelMeta: { guildName: string; channelName: string; channelTopic: string | null };
  history: ChannelHistoryEntry[];
  target: ChannelHistoryEntry & { id: string };
};
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: Pass.

- [ ] **Step 3: Commit**

```bash
git add src/main/autonomy/types.ts
git commit -m "feat(autonomy): subsystem type definitions"
```

---

## Task 5: Prompt assembly

**Files:**
- Create: `src/main/autonomy/prompt.ts`
- Test: `src/main/autonomy/__tests__/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/autonomy/__tests__/prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../prompt';
import type { PromptInputs } from '../types';

const baseInputs = (): PromptInputs => ({
  systemPrompt: 'be helpful',
  channelMeta: { guildName: 'My Server', channelName: 'general', channelTopic: 'casual chat' },
  history: [
    { authorId: 'u1', authorDisplayName: 'Alice', isBot: false, createdAt: Date.UTC(2026, 3, 29, 12, 0, 0), content: 'hi all' },
    { authorId: 'u2', authorDisplayName: 'Bob', isBot: false, createdAt: Date.UTC(2026, 3, 29, 12, 1, 0), content: 'hey' },
  ],
  target: { id: 'm1', authorId: 'u1', authorDisplayName: 'Alice', isBot: false, createdAt: Date.UTC(2026, 3, 29, 12, 2, 0), content: '@bot what time is it?' },
});

describe('buildPrompt', () => {
  it('puts system rules + persona at the top', () => {
    const out = buildPrompt(baseInputs());
    expect(out).toMatch(/Stay in character/);
    expect(out).toMatch(/exactly one Discord message/);
    expect(out).toMatch(/Never use @everyone or @here/);
    expect(out).toMatch(/under 2000 characters/);
    expect(out).toMatch(/be helpful/);
  });

  it('includes channel metadata', () => {
    const out = buildPrompt(baseInputs());
    expect(out).toMatch(/My Server/);
    expect(out).toMatch(/#general/);
    expect(out).toMatch(/casual chat/);
  });

  it('separates background context from the target message', () => {
    const out = buildPrompt(baseInputs());
    const ctxIdx = out.indexOf('Recent channel context');
    const tgtIdx = out.indexOf('Respond to this single message');
    expect(ctxIdx).toBeGreaterThan(0);
    expect(tgtIdx).toBeGreaterThan(ctxIdx);
    expect(out).toMatch(/do NOT respond to these/i);
  });

  it('renders history entries with display name and time', () => {
    const out = buildPrompt(baseInputs());
    expect(out).toMatch(/Alice.*hi all/s);
    expect(out).toMatch(/Bob.*hey/s);
  });

  it('omits topic line when topic is null', () => {
    const inputs = baseInputs();
    inputs.channelMeta.channelTopic = null;
    const out = buildPrompt(inputs);
    expect(out).not.toMatch(/Topic:/);
  });

  it('handles empty history with a placeholder', () => {
    const inputs = baseInputs();
    inputs.history = [];
    const out = buildPrompt(inputs);
    expect(out).toMatch(/no recent messages/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/autonomy/__tests__/prompt.test.ts`
Expected: FAIL — `Cannot find module '../prompt'`.

- [ ] **Step 3: Implement `buildPrompt`**

Create `src/main/autonomy/prompt.ts`:

```ts
import type { PromptInputs, ChannelHistoryEntry } from './types';

const HARD_RULES = [
  'You are participating in a Discord text channel.',
  'Stay in character.',
  'Reply with exactly one Discord message.',
  'Never use @everyone or @here.',
  'Keep replies under 2000 characters.',
  'Use plain text. No markdown headings or code fences unless asked.',
].join('\n');

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

const renderEntry = (e: ChannelHistoryEntry): string =>
  `[${formatTime(e.createdAt)}] ${e.authorDisplayName}${e.isBot ? ' (bot)' : ''}: ${e.content}`;

export function buildPrompt(inputs: PromptInputs): string {
  const { systemPrompt, channelMeta, history, target } = inputs;
  const topicLine = channelMeta.channelTopic ? `Topic: ${channelMeta.channelTopic}` : '';
  const meta = [
    `Server: ${channelMeta.guildName}`,
    `Channel: #${channelMeta.channelName}`,
    topicLine,
  ].filter(Boolean).join('\n');

  const historyBlock = history.length === 0
    ? '(no recent messages)'
    : history.map(renderEntry).join('\n');

  return [
    'SYSTEM RULES (must obey):',
    HARD_RULES,
    '',
    'PERSONA:',
    systemPrompt,
    '',
    'CHANNEL:',
    meta,
    '',
    'Recent channel context — for situational awareness only. Do NOT respond to these messages:',
    historyBlock,
    '',
    'Respond to this single message:',
    renderEntry(target),
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/main/autonomy/__tests__/prompt.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/autonomy/prompt.ts src/main/autonomy/__tests__/prompt.test.ts
git commit -m "feat(autonomy): prompt assembly with background/target separation"
```

---

## Task 6: Output post-processing

**Files:**
- Create: `src/main/autonomy/post-process.ts`
- Test: `src/main/autonomy/__tests__/post-process.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/autonomy/__tests__/post-process.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { postProcess } from '../post-process';

describe('postProcess', () => {
  it('returns null for empty / whitespace-only output', () => {
    expect(postProcess('')).toBeNull();
    expect(postProcess('   \n  \t')).toBeNull();
  });

  it('strips @everyone and @here', () => {
    expect(postProcess('hello @everyone how are you')).toBe('hello how are you');
    expect(postProcess('@here look')).toBe('look');
    expect(postProcess('mid @everyone-text')).toBe('mid -text');
  });

  it('passes short text through', () => {
    expect(postProcess('all good')).toBe('all good');
  });

  it('truncates long text at the last sentence boundary under 2000', () => {
    const sentence = 'a'.repeat(50) + '. ';
    const long = sentence.repeat(60); // ~3120 chars
    const out = postProcess(long)!;
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out.endsWith('.')).toBe(true);
  });

  it('hard-truncates at 2000 if no sentence boundary exists', () => {
    const long = 'x'.repeat(2500);
    const out = postProcess(long)!;
    expect(out.length).toBe(2000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/autonomy/__tests__/post-process.test.ts`
Expected: FAIL — `Cannot find module '../post-process'`.

- [ ] **Step 3: Implement**

Create `src/main/autonomy/post-process.ts`:

```ts
const MAX = 2000;

export function postProcess(raw: string): string | null {
  let text = raw
    .replace(/@everyone/g, '')
    .replace(/@here/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (text.length === 0) return null;

  if (text.length > MAX) {
    const head = text.slice(0, MAX);
    const m = head.match(/[.!?](?=\s|$)(?!.*[.!?](?=\s|$))/s);
    if (m && m.index !== undefined) {
      text = head.slice(0, m.index + 1);
    } else {
      text = head;
    }
  }
  return text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/main/autonomy/__tests__/post-process.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/autonomy/post-process.ts src/main/autonomy/__tests__/post-process.test.ts
git commit -m "feat(autonomy): output post-processing — strip pings, truncate"
```

---

## Task 7: Throttle (cooldown + global rate cap + in-flight set)

**Files:**
- Create: `src/main/autonomy/throttle.ts`
- Test: `src/main/autonomy/__tests__/throttle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/autonomy/__tests__/throttle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createThrottle } from '../throttle';

describe('throttle', () => {
  it('allows the first request and blocks within cooldown', () => {
    let now = 1000;
    const t = createThrottle({ rateCapPerMin: 100, now: () => now });
    expect(t.tryStart('c1', 5000)).toBe('ok');
    now += 100;
    expect(t.tryStart('c1', 5000)).toBe('cooldown');
  });

  it('allows again after cooldown elapses', () => {
    let now = 1000;
    const t = createThrottle({ rateCapPerMin: 100, now: () => now });
    expect(t.tryStart('c1', 5000)).toBe('ok');
    t.finish('c1');
    now += 5001;
    expect(t.tryStart('c1', 5000)).toBe('ok');
  });

  it('blocks when in-flight on the same channel', () => {
    let now = 1000;
    const t = createThrottle({ rateCapPerMin: 100, now: () => now });
    expect(t.tryStart('c1', 0)).toBe('ok');
    expect(t.tryStart('c1', 0)).toBe('in-flight');
  });

  it('drops over the global rate cap inside one minute', () => {
    let now = 1000;
    const t = createThrottle({ rateCapPerMin: 2, now: () => now });
    expect(t.tryStart('c1', 0)).toBe('ok'); t.finish('c1');
    now += 1; expect(t.tryStart('c2', 0)).toBe('ok'); t.finish('c2');
    now += 1; expect(t.tryStart('c3', 0)).toBe('rate-cap');
  });

  it('refills the bucket as the window slides', () => {
    let now = 1000;
    const t = createThrottle({ rateCapPerMin: 1, now: () => now });
    expect(t.tryStart('c1', 0)).toBe('ok'); t.finish('c1');
    expect(t.tryStart('c2', 0)).toBe('rate-cap');
    now += 60_001;
    expect(t.tryStart('c2', 0)).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/autonomy/__tests__/throttle.test.ts`
Expected: FAIL — `Cannot find module '../throttle'`.

- [ ] **Step 3: Implement throttle**

Create `src/main/autonomy/throttle.ts`:

```ts
export type ThrottleResult = 'ok' | 'cooldown' | 'in-flight' | 'rate-cap';

export interface Throttle {
  tryStart(channelId: string, cooldownMs: number): ThrottleResult;
  finish(channelId: string): void;
  abortAll(): void;
}

export function createThrottle(opts: { rateCapPerMin: (() => number) | number; now?: () => number }): Throttle {
  const now = opts.now ?? (() => Date.now());
  const rateCapValue = opts.rateCapPerMin;
  const rateCap = typeof rateCapValue === 'function' ? rateCapValue : () => rateCapValue;

  const lastFiredAt = new Map<string, number>();
  const inFlight = new Set<string>();
  const recentStartTimes: number[] = [];

  return {
    tryStart(channelId, cooldownMs) {
      if (inFlight.has(channelId)) return 'in-flight';
      const t = now();
      const last = lastFiredAt.get(channelId);
      if (last !== undefined && t - last < cooldownMs) return 'cooldown';

      while (recentStartTimes.length > 0 && t - recentStartTimes[0]! >= 60_000) {
        recentStartTimes.shift();
      }
      if (recentStartTimes.length >= rateCap()) return 'rate-cap';

      recentStartTimes.push(t);
      lastFiredAt.set(channelId, t);
      inFlight.add(channelId);
      return 'ok';
    },
    finish(channelId) {
      inFlight.delete(channelId);
    },
    abortAll() {
      inFlight.clear();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/main/autonomy/__tests__/throttle.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/autonomy/throttle.ts src/main/autonomy/__tests__/throttle.test.ts
git commit -m "feat(autonomy): throttle with cooldown, in-flight guard, sliding rate cap"
```

---

## Task 8: Autonomy module wiring

**Files:**
- Create: `src/main/autonomy/index.ts`
- Test: `src/main/autonomy/__tests__/autonomy.test.ts`

This task wires prompt + post-process + throttle + a CDK host (injected) into a single module. The real `CDKHost` from `@claude-cdk/core` will be plugged in at the call site (Task 12); tests use a fake.

- [ ] **Step 1: Write the failing test**

Create `src/main/autonomy/__tests__/autonomy.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createAutonomyModule, type AutonomyEvents } from '../index';
import type { AutonomyHost, AutonomySession, ChannelHistoryEntry } from '../types';
import type { CDKEvent } from '@claude-cdk/core';

function fakeHost(scriptedDeltas: string[]): AutonomyHost {
  return {
    detect: async () => ({ found: true, version: '0.0.0' }),
    startSession: async (): Promise<AutonomySession> => ({
      send: () => (async function* (): AsyncGenerator<CDKEvent> {
        for (const d of scriptedDeltas) yield { type: 'assistant.text_delta', delta: d } as CDKEvent;
        yield { type: 'session.done', stopReason: 'end_turn' } as CDKEvent;
      })(),
      abort: async () => {},
      close: async () => {},
    }),
  };
}

const fakeChannelMeta = { guildName: 'G', channelName: 'c', channelTopic: null };
const target = { id: 'm1', authorId: 'u1', authorDisplayName: 'Alice', isBot: false, createdAt: 1, content: 'hi' };
const history: ChannelHistoryEntry[] = [];

describe('createAutonomyModule', () => {
  it('generates a reply via the host and emits assembled text', async () => {
    const events: AutonomyEvents = { onDelta: vi.fn(), onDone: vi.fn() };
    const mod = createAutonomyModule({
      host: fakeHost(['hel', 'lo ', 'world']),
      globalConfig: () => ({ enabled: true, systemPrompt: 'be brief', rateCapPerMin: 100 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events,
    });
    const res = await mod.draftReply({
      requestId: 'r1',
      channelMeta: fakeChannelMeta,
      history,
      target,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe('hello world');
    expect(events.onDelta).toHaveBeenCalledTimes(3);
    expect(events.onDone).toHaveBeenCalledOnce();
  });

  it('runAutonomous skips when global is disabled', async () => {
    const startSpy = vi.fn();
    const host: AutonomyHost = { detect: async () => ({ found: true }), startSession: startSpy as never };
    const mod = createAutonomyModule({
      host,
      globalConfig: () => ({ enabled: false, systemPrompt: '', rateCapPerMin: 100 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
    });
    const res = await mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('global-disabled');
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('runAutonomous skips when channel is not in allowlist', async () => {
    const mod = createAutonomyModule({
      host: fakeHost([]),
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['other'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
    });
    const res = await mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: { ...fakeChannelMeta, channelName: 'c' }, history, target });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not-allowed');
  });

  it('runAutonomous post-processes the assembled text', async () => {
    const mod = createAutonomyModule({
      host: fakeHost(['hello @everyone there']),
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
    });
    const res = await mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe('hello there');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/autonomy/__tests__/autonomy.test.ts`
Expected: FAIL — `Cannot find module '../index'`.

- [ ] **Step 3: Implement the module**

Create `src/main/autonomy/index.ts`:

```ts
import type { CDKEvent } from '@claude-cdk/core';
import type { GuildAutonomyConfig, GlobalAutonomyConfig } from '../../shared/domain';
import { DEFAULT_GLOBAL_SYSTEM_PROMPT } from '../../shared/domain';
import type { AutonomyHost, AutonomySession, ChannelHistoryEntry, PromptInputs } from './types';
import { buildPrompt } from './prompt';
import { postProcess } from './post-process';
import { createThrottle, type Throttle } from './throttle';

export type AutonomyEvents = {
  onDelta: (requestId: string, delta: string) => void;
  onDone: (requestId: string, text: string, stopReason: string | undefined) => void;
};

export type DraftRequest = {
  requestId: string;
  channelMeta: { guildName: string; channelName: string; channelTopic: string | null };
  history: ChannelHistoryEntry[];
  target: ChannelHistoryEntry & { id: string };
};

export type DraftResult =
  | { ok: true; text: string; stopReason: string | undefined }
  | { ok: false; error: string };

export type RunAutonomousRequest = {
  guildId: string;
  channelId: string;
  channelMeta: DraftRequest['channelMeta'];
  history: ChannelHistoryEntry[];
  target: DraftRequest['target'];
};

export type RunAutonomousResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'global-disabled' | 'guild-disabled' | 'not-allowed' | 'cooldown' | 'in-flight' | 'rate-cap' | 'cli-missing' | 'empty-output' | 'host-error'; message?: string };

export type AutonomyModule = {
  draftReply(req: DraftRequest): Promise<DraftResult>;
  runAutonomous(req: RunAutonomousRequest): Promise<RunAutonomousResult>;
  abortChannel(channelId: string): void;
  cancelDraft(requestId: string): Promise<void>;
};

type CreateOpts = {
  host: AutonomyHost;
  globalConfig: () => GlobalAutonomyConfig;
  guildConfig: (guildId: string) => GuildAutonomyConfig;
  cwd: string;
  events: AutonomyEvents;
  now?: () => number;
};

export function createAutonomyModule(opts: CreateOpts): AutonomyModule {
  const throttle: Throttle = createThrottle({
    rateCapPerMin: () => opts.globalConfig().rateCapPerMin,
    now: opts.now,
  });

  const draftSessions = new Map<string, AutonomySession>(); // requestId → session
  const channelSessions = new Map<string, AutonomySession>();

  const resolveSystemPrompt = (guildId: string | null): string => {
    const g = opts.globalConfig();
    if (!guildId) return g.systemPrompt || DEFAULT_GLOBAL_SYSTEM_PROMPT;
    const cfg = opts.guildConfig(guildId);
    if (cfg.systemPrompt && cfg.systemPrompt.trim().length > 0) return cfg.systemPrompt;
    return g.systemPrompt || DEFAULT_GLOBAL_SYSTEM_PROMPT;
  };

  const collectText = async (
    session: AutonomySession,
    prompt: string,
    onDelta?: (delta: string) => void,
  ): Promise<{ text: string; stopReason: string | undefined }> => {
    let text = '';
    let stopReason: string | undefined;
    for await (const ev of session.send(prompt) as AsyncIterable<CDKEvent>) {
      if (ev.type === 'assistant.text_delta') {
        text += ev.delta;
        onDelta?.(ev.delta);
      } else if (ev.type === 'session.done') {
        stopReason = ev.stopReason;
      }
    }
    return { text, stopReason };
  };

  return {
    async draftReply(req) {
      const sysPrompt = resolveSystemPrompt(null);
      const inputs: PromptInputs = {
        systemPrompt: sysPrompt,
        channelMeta: req.channelMeta,
        history: req.history,
        target: req.target,
      };
      const prompt = buildPrompt(inputs);

      let session: AutonomySession;
      try {
        session = await opts.host.startSession({ cwd: opts.cwd });
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      draftSessions.set(req.requestId, session);
      try {
        const { text, stopReason } = await collectText(session, prompt, (d) => opts.events.onDelta(req.requestId, d));
        opts.events.onDone(req.requestId, text, stopReason);
        return { ok: true, text, stopReason };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      } finally {
        draftSessions.delete(req.requestId);
        try { await session.close(); } catch { /* ignore */ }
      }
    },

    async runAutonomous(req) {
      const g = opts.globalConfig();
      if (!g.enabled) return { ok: false, reason: 'global-disabled' };
      const cfg = opts.guildConfig(req.guildId);
      if (!cfg.enabled) return { ok: false, reason: 'guild-disabled' };
      if (!cfg.channelIds.includes(req.channelId)) return { ok: false, reason: 'not-allowed' };

      const start = throttle.tryStart(req.channelId, cfg.cooldownMs);
      if (start === 'cooldown') return { ok: false, reason: 'cooldown' };
      if (start === 'in-flight') return { ok: false, reason: 'in-flight' };
      if (start === 'rate-cap') return { ok: false, reason: 'rate-cap' };

      const sysPrompt = resolveSystemPrompt(req.guildId);
      const prompt = buildPrompt({
        systemPrompt: sysPrompt,
        channelMeta: req.channelMeta,
        history: req.history,
        target: req.target,
      });

      let session: AutonomySession;
      try {
        session = await opts.host.startSession({ cwd: opts.cwd });
      } catch (e) {
        throttle.finish(req.channelId);
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, reason: 'host-error', message: msg };
      }
      channelSessions.set(req.channelId, session);
      try {
        const { text } = await collectText(session, prompt);
        const cleaned = postProcess(text);
        if (!cleaned) return { ok: false, reason: 'empty-output' };
        return { ok: true, text: cleaned };
      } catch (e) {
        return { ok: false, reason: 'host-error', message: e instanceof Error ? e.message : String(e) };
      } finally {
        channelSessions.delete(req.channelId);
        throttle.finish(req.channelId);
        try { await session.close(); } catch { /* ignore */ }
      }
    },

    abortChannel(channelId) {
      const s = channelSessions.get(channelId);
      if (s) void s.abort().catch(() => {});
    },

    async cancelDraft(requestId) {
      const s = draftSessions.get(requestId);
      if (s) {
        try { await s.abort(); } catch { /* ignore */ }
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/main/autonomy/__tests__/autonomy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/autonomy/index.ts src/main/autonomy/__tests__/autonomy.test.ts
git commit -m "feat(autonomy): module wiring with draftReply + runAutonomous"
```

---

## Task 9: Shared IPC contract additions

**Files:**
- Modify: `src/shared/ipc-contract.ts`

This task adds types and channel constants only. No tests yet — handlers come in Task 10.

- [ ] **Step 1: Edit `BotcordApi`**

Edit `src/shared/ipc-contract.ts`:

1. Add to the imports at the top:

```ts
import type {
  // ... existing imports ...
  GuildAutonomyConfig, GlobalAutonomyConfig,
} from './domain';
```

2. Add to `BotcordApi` (anywhere in the interface; place after `prefs`):

```ts
autonomy: {
  detect(): Promise<{ found: boolean; version?: string; reason?: string }>;
  getGuildConfig(guildId: string): Promise<Result<GuildAutonomyConfig>>;
  setGuildConfig(guildId: string, partial: Partial<Omit<GuildAutonomyConfig, 'guildId' | 'updatedAt'>>): Promise<Result<GuildAutonomyConfig>>;
  getGlobalConfig(): Promise<Result<GlobalAutonomyConfig>>;
  setGlobalConfig(partial: Partial<GlobalAutonomyConfig>): Promise<Result<GlobalAutonomyConfig>>;
  draftReply(channelId: string, messageId: string): Promise<Result<{ requestId: string }>>;
  cancelDraft(requestId: string): Promise<Result<void>>;
};
```

3. Add to `events` (BotcordApi):

```ts
onAutonomyDraftDelta(cb: (p: { requestId: string; delta: string }) => void): () => void;
onAutonomyDraftDone(cb: (p: { requestId: string; text: string; stopReason: string | undefined }) => void): () => void;
```

4. Add to `IPC_CHANNELS`:

```ts
'autonomy.detect': 'autonomy.detect',
'autonomy.getGuildConfig': 'autonomy.getGuildConfig',
'autonomy.setGuildConfig': 'autonomy.setGuildConfig',
'autonomy.getGlobalConfig': 'autonomy.getGlobalConfig',
'autonomy.setGlobalConfig': 'autonomy.setGlobalConfig',
'autonomy.draftReply': 'autonomy.draftReply',
'autonomy.cancelDraft': 'autonomy.cancelDraft',
'event.autonomyDraftDelta': 'event.autonomyDraftDelta',
'event.autonomyDraftDone': 'event.autonomyDraftDone',
```

- [ ] **Step 2: Update preload**

Edit `src/preload/expose.ts`. Add to the `api` object (after `prefs`):

```ts
autonomy: {
  detect: () => invoke(IPC_CHANNELS['autonomy.detect']),
  getGuildConfig: (guildId) => invoke(IPC_CHANNELS['autonomy.getGuildConfig'], guildId),
  setGuildConfig: (guildId, partial) => invoke(IPC_CHANNELS['autonomy.setGuildConfig'], guildId, partial),
  getGlobalConfig: () => invoke(IPC_CHANNELS['autonomy.getGlobalConfig']),
  setGlobalConfig: (partial) => invoke(IPC_CHANNELS['autonomy.setGlobalConfig'], partial),
  draftReply: (channelId, messageId) => invoke(IPC_CHANNELS['autonomy.draftReply'], channelId, messageId),
  cancelDraft: (requestId) => invoke(IPC_CHANNELS['autonomy.cancelDraft'], requestId),
},
```

And add to `events`:

```ts
onAutonomyDraftDelta: (cb) => subscribe(IPC_CHANNELS['event.autonomyDraftDelta'], cb as (p: unknown) => void),
onAutonomyDraftDone: (cb) => subscribe(IPC_CHANNELS['event.autonomyDraftDone'], cb as (p: unknown) => void),
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/expose.ts
git commit -m "feat(autonomy): IPC contract — autonomy.* channels + events"
```

---

## Task 10: Whitelist new prefs keys

**Files:**
- Modify: `src/main/ipc/prefs.ts`

- [ ] **Step 1: Edit `VALID_KEYS`**

Edit `src/main/ipc/prefs.ts` line 8:

```ts
const VALID_KEYS: ReadonlyArray<keyof Prefs> = [
  'lastSelectedGuildId', 'lastSelectedChannelId', 'theme',
  'collapsedCategoryIds', 'memberListOpen', 'channelLastSeen',
  'mutedChannelIds', 'giphyApiKey',
  'autonomyGlobalEnabled', 'autonomyGlobalSystemPrompt', 'autonomyGlobalRateCapPerMin',
];
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/prefs.ts
git commit -m "feat(autonomy): whitelist autonomy global prefs keys"
```

---

## Task 11: Autonomy IPC handlers

**Files:**
- Create: `src/main/ipc/autonomy.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/events/gateway-events.ts` — add the two new event channel constants.

- [ ] **Step 1: Add event channel constants**

Edit `src/main/events/gateway-events.ts`. Append (matching existing exported constants):

```ts
export const AUTONOMY_DRAFT_DELTA_CHANNEL = 'event.autonomyDraftDelta';
export const AUTONOMY_DRAFT_DONE_CHANNEL = 'event.autonomyDraftDone';
```

- [ ] **Step 2: Create handlers**

Create `src/main/ipc/autonomy.ts`:

```ts
import { ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { GuildAutonomyConfig, GlobalAutonomyConfig } from '../../shared/domain';
import { DEFAULT_GLOBAL_SYSTEM_PROMPT } from '../../shared/domain';
import type { IpcDeps } from './index';
import { createAutonomyRepo } from '../db/repos/autonomy';
import { createPrefsRepo } from '../db/repos/prefs';
import type { AutonomyModule } from '../autonomy';
import type { AutonomyHost } from '../autonomy/types';

type Deps = IpcDeps & { autonomy: AutonomyModule; host: AutonomyHost };

export function registerAutonomyHandlers({ db, manager, autonomy, host }: Deps): void {
  const repo = createAutonomyRepo(db);
  const prefs = createPrefsRepo(db);

  const readGlobal = (): GlobalAutonomyConfig => ({
    enabled: prefs.get('autonomyGlobalEnabled') ?? false,
    systemPrompt: prefs.get('autonomyGlobalSystemPrompt') ?? DEFAULT_GLOBAL_SYSTEM_PROMPT,
    rateCapPerMin: prefs.get('autonomyGlobalRateCapPerMin') ?? 20,
  });

  ipcMain.handle(IPC_CHANNELS['autonomy.detect'], async () => host.detect());

  ipcMain.handle(IPC_CHANNELS['autonomy.getGuildConfig'], async (_, guildId: unknown): Promise<Result<GuildAutonomyConfig>> => {
    if (typeof guildId !== 'string') return err('INTERNAL', 'guildId must be a string');
    return ok(repo.getGuildConfig(guildId));
  });

  ipcMain.handle(IPC_CHANNELS['autonomy.setGuildConfig'], async (_, guildId: unknown, partial: unknown): Promise<Result<GuildAutonomyConfig>> => {
    if (typeof guildId !== 'string') return err('INTERNAL', 'guildId must be a string');
    if (!partial || typeof partial !== 'object') return err('INTERNAL', 'partial must be an object');
    const updated = repo.upsertGuildConfig(guildId, partial as Partial<GuildAutonomyConfig>);
    return ok(updated);
  });

  ipcMain.handle(IPC_CHANNELS['autonomy.getGlobalConfig'], async (): Promise<Result<GlobalAutonomyConfig>> => ok(readGlobal()));

  ipcMain.handle(IPC_CHANNELS['autonomy.setGlobalConfig'], async (_, partial: unknown): Promise<Result<GlobalAutonomyConfig>> => {
    if (!partial || typeof partial !== 'object') return err('INTERNAL', 'partial must be an object');
    const p = partial as Partial<GlobalAutonomyConfig>;
    if (typeof p.enabled === 'boolean') prefs.set('autonomyGlobalEnabled', p.enabled);
    if (typeof p.systemPrompt === 'string') prefs.set('autonomyGlobalSystemPrompt', p.systemPrompt);
    if (typeof p.rateCapPerMin === 'number' && p.rateCapPerMin > 0) prefs.set('autonomyGlobalRateCapPerMin', Math.floor(p.rateCapPerMin));
    return ok(readGlobal());
  });

  ipcMain.handle(IPC_CHANNELS['autonomy.draftReply'], async (_, channelId: unknown, messageId: unknown): Promise<Result<{ requestId: string }>> => {
    if (typeof channelId !== 'string' || typeof messageId !== 'string') return err('INTERNAL', 'channelId and messageId must be strings');
    if (!readGlobal().enabled) return err('INTERNAL', 'autonomy globally disabled');

    const client = manager.getClient();
    if (!client) return err('GATEWAY_OFFLINE', 'bot not connected');

    let channel;
    try { channel = await client.channels.fetch(channelId); } catch (e) {
      return err('NOT_FOUND', e instanceof Error ? e.message : 'channel fetch failed');
    }
    if (!channel || !channel.isTextBased()) return err('NOT_FOUND', 'channel not text-based');

    let triggerMsg;
    try { triggerMsg = await channel.messages.fetch(messageId); } catch (e) {
      return err('NOT_FOUND', e instanceof Error ? e.message : 'message fetch failed');
    }

    const requestId = randomUUID();
    // Fire and forget — events stream via broadcast.
    void (async () => {
      const cfg = repo.getGuildConfig(triggerMsg.guildId ?? '');
      const histLimit = Math.min(cfg.contextSize, 100);
      const fetched = await channel.messages.fetch({ limit: histLimit + 1, before: triggerMsg.id }).catch(() => null);
      const history = fetched
        ? Array.from(fetched.values())
            .filter(m => m.id !== triggerMsg.id)
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
            .map(m => ({
              authorId: m.author.id,
              authorDisplayName: m.member?.displayName ?? m.author.globalName ?? m.author.username,
              isBot: m.author.bot ?? false,
              createdAt: m.createdTimestamp,
              content: m.content,
            }))
        : [];
      const channelMeta = {
        guildName: triggerMsg.guild?.name ?? '(direct message)',
        channelName: 'name' in channel && typeof channel.name === 'string' ? channel.name : 'channel',
        channelTopic: 'topic' in channel && typeof channel.topic === 'string' ? channel.topic : null,
      };
      await autonomy.draftReply({
        requestId,
        channelMeta,
        history,
        target: {
          id: triggerMsg.id,
          authorId: triggerMsg.author.id,
          authorDisplayName: triggerMsg.member?.displayName ?? triggerMsg.author.globalName ?? triggerMsg.author.username,
          isBot: triggerMsg.author.bot ?? false,
          createdAt: triggerMsg.createdTimestamp,
          content: triggerMsg.content,
        },
      });
    })();
    return ok({ requestId });
  });

  ipcMain.handle(IPC_CHANNELS['autonomy.cancelDraft'], async (_, requestId: unknown): Promise<Result<void>> => {
    if (typeof requestId !== 'string') return err('INTERNAL', 'requestId must be a string');
    await autonomy.cancelDraft(requestId);
    return ok(undefined);
  });
}
```

- [ ] **Step 3: Wire into the registry**

Edit `src/main/ipc/index.ts`:

```ts
import type { TokenVault } from '../vault/token-vault';
import type { Database as DB } from 'better-sqlite3';
import { registerBotHandlers } from './bot';
import { registerGuildHandlers } from './guilds';
import { registerMessageHandlers } from './messages';
import { registerSystemHandlers } from './system';
import { registerDraftsHandlers } from './drafts';
import { registerPrefsHandlers } from './prefs';
import { registerMembersBulkHandlers } from './members-bulk';
import { registerVoiceHandlers } from './voice';
import { registerAutonomyHandlers } from './autonomy';
import type { ClientManager } from '../discord/client-manager';
import type { AutonomyModule } from '../autonomy';
import type { AutonomyHost } from '../autonomy/types';

export type IpcDeps = {
  vault: TokenVault;
  manager: ClientManager;
  db: DB;
};

export type IpcDepsWithAutonomy = IpcDeps & { autonomy: AutonomyModule; host: AutonomyHost };

export function registerAllIpc(deps: IpcDepsWithAutonomy): void {
  registerBotHandlers(deps);
  registerGuildHandlers(deps);
  registerMessageHandlers(deps);
  registerSystemHandlers();
  registerDraftsHandlers(deps);
  registerPrefsHandlers(deps);
  registerMembersBulkHandlers(deps);
  registerVoiceHandlers(deps);
  registerAutonomyHandlers(deps);
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/autonomy.ts src/main/ipc/index.ts src/main/events/gateway-events.ts
git commit -m "feat(autonomy): IPC handlers for config, draft, cancel"
```

---

## Task 12: Wire CDK host + autonomous listener in main entry

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/discord/client-manager.ts` — add an external listener-registration hook so the autonomous path can subscribe without duplicating intent setup. (Cleanest: the autonomy module receives the `manager` and listens via `manager.getClient()` after connect.)
- Create: `src/main/autonomy/listener.ts` — registers the discord.js listener and ties it to the module.

- [ ] **Step 1: Add a listener registration helper**

Create `src/main/autonomy/listener.ts`:

```ts
import { Events, type Client, type Message } from 'discord.js';
import type { ClientManager } from '../discord/client-manager';
import type { AutonomyModule } from './index';
import { broadcast } from '../events/gateway-events';
import { MESSAGE_CREATE_CHANNEL } from '../events/gateway-events';
import type { AutonomyRepo } from '../db/repos/autonomy';
import { summarizeMessage } from '../discord/client-manager';

type Deps = {
  manager: ClientManager;
  autonomy: AutonomyModule;
  repo: AutonomyRepo;
};

export function attachAutonomousListener({ manager, autonomy, repo }: Deps): () => void {
  let attached = false;
  let bound: ((m: Message) => void) | null = null;

  const tryAttach = () => {
    const client: Client | null = manager.getClient();
    if (!client || attached) return;
    attached = true;
    bound = (m: Message) => { void handle(m, client); };
    client.on(Events.MessageCreate, bound);
  };

  const handle = async (m: Message, client: Client) => {
    if (m.author.bot) return;
    if (!m.guildId) return; // guild-only for now
    if (m.system) return;

    const botId = client.user?.id;
    if (!botId) return;

    const isMention = m.mentions.has(botId);
    const isReplyToBot = !!m.reference?.messageId && (await isReplyTargetingBot(m, botId));
    if (!isMention && !isReplyToBot) return;

    const cfg = repo.getGuildConfig(m.guildId);
    if (!cfg.enabled || !cfg.channelIds.includes(m.channelId)) return;

    const ch = m.channel;
    const histLimit = Math.min(cfg.contextSize, 100);
    const fetched = await ch.messages.fetch({ limit: histLimit + 1, before: m.id }).catch(() => null);
    const history = fetched
      ? Array.from(fetched.values())
          .filter(x => x.id !== m.id)
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .map(x => ({
            authorId: x.author.id,
            authorDisplayName: x.member?.displayName ?? x.author.globalName ?? x.author.username,
            isBot: x.author.bot ?? false,
            createdAt: x.createdTimestamp,
            content: x.content,
          }))
      : [];

    const channelMeta = {
      guildName: m.guild?.name ?? '(unknown server)',
      channelName: 'name' in ch && typeof ch.name === 'string' ? ch.name : 'channel',
      channelTopic: 'topic' in ch && typeof ch.topic === 'string' ? ch.topic : null,
    };

    const result = await autonomy.runAutonomous({
      guildId: m.guildId,
      channelId: m.channelId,
      channelMeta,
      history,
      target: {
        id: m.id,
        authorId: m.author.id,
        authorDisplayName: m.member?.displayName ?? m.author.globalName ?? m.author.username,
        isBot: false,
        createdAt: m.createdTimestamp,
        content: m.content,
      },
    });

    if (!result.ok) return;

    try {
      const sent = await ch.send({ content: result.text, reply: { messageReference: m.id, failIfNotExists: false } });
      broadcast(MESSAGE_CREATE_CHANNEL, { channelId: sent.channelId, message: summarizeMessage(sent) });
    } catch {
      // log path: no retry to avoid duplicates
    }
  };

  const isReplyTargetingBot = async (m: Message, botId: string): Promise<boolean> => {
    const refId = m.reference?.messageId;
    if (!refId) return false;
    try {
      const ref = await m.channel.messages.fetch(refId);
      return ref.author.id === botId;
    } catch {
      return false;
    }
  };

  // Re-attach when the manager reconnects.
  const interval = setInterval(tryAttach, 1000);
  tryAttach();

  return () => {
    clearInterval(interval);
    const c = manager.getClient();
    if (c && bound) c.off(Events.MessageCreate, bound);
  };
}
```

- [ ] **Step 2: Wire in `src/main/index.ts`**

Replace the contents of `src/main/index.ts` with:

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { createMainWindow } from './window';
import { installCSP } from './security/csp';
import { createTokenVault } from './vault/token-vault';
import { createClientManager } from './discord/client-manager';
import { openDatabase } from './db/database';
import { registerAllIpc } from './ipc';
import { registerUpdater } from './updater';
import { CDKHost } from '@claude-cdk/core';
import { createAutonomyModule } from './autonomy';
import { createAutonomyRepo } from './db/repos/autonomy';
import { createPrefsRepo } from './db/repos/prefs';
import { DEFAULT_GLOBAL_SYSTEM_PROMPT } from '../shared/domain';
import { attachAutonomousListener } from './autonomy/listener';
import {
  AUTONOMY_DRAFT_DELTA_CHANNEL,
  AUTONOMY_DRAFT_DONE_CHANNEL,
  broadcast,
} from './events/gateway-events';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    installCSP();

    const userData = app.getPath('userData');
    const vault = createTokenVault(join(userData, 'vault'));
    const manager = createClientManager(vault);
    const db = openDatabase(join(userData, 'botcord.sqlite'));

    const cdkScratch = join(userData, 'cdk-scratch');
    mkdirSync(cdkScratch, { recursive: true });

    const host = new CDKHost();
    const repo = createAutonomyRepo(db);
    const prefs = createPrefsRepo(db);

    const autonomy = createAutonomyModule({
      host,
      cwd: cdkScratch,
      globalConfig: () => ({
        enabled: prefs.get('autonomyGlobalEnabled') ?? false,
        systemPrompt: prefs.get('autonomyGlobalSystemPrompt') ?? DEFAULT_GLOBAL_SYSTEM_PROMPT,
        rateCapPerMin: prefs.get('autonomyGlobalRateCapPerMin') ?? 20,
      }),
      guildConfig: (guildId) => repo.getGuildConfig(guildId),
      events: {
        onDelta: (requestId, delta) => broadcast(AUTONOMY_DRAFT_DELTA_CHANNEL, { requestId, delta }),
        onDone: (requestId, text, stopReason) => broadcast(AUTONOMY_DRAFT_DONE_CHANNEL, { requestId, text, stopReason }),
      },
    });

    attachAutonomousListener({ manager, autonomy, repo });

    registerAllIpc({ vault, manager, db, autonomy, host });

    const win = createMainWindow();
    registerUpdater(win);

    if (vault.hasToken()) {
      manager.connect().catch(() => { /* surfaced via gateway state events */ });
    }
  });

  app.on('window-all-closed', () => app.quit());
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All previously passing tests still pass; no new failures.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/main/autonomy/listener.ts
git commit -m "feat(autonomy): wire CDKHost + autonomous listener at startup"
```

---

## Task 13: Renderer — composer-bus and Composer integration

**Files:**
- Create: `src/renderer/lib/composer-bus.ts`
- Modify: `src/renderer/components/Composer.tsx`

The composer-bus is a tiny pub/sub used to deliver streamed draft text from anywhere in the renderer into the active Composer (matching the pattern of `Toaster.pushToast`).

- [ ] **Step 1: Create the bus**

Create `src/renderer/lib/composer-bus.ts`:

```ts
type Listener = (action: ComposerBusAction) => void;

export type ComposerBusAction =
  | { kind: 'append'; channelId: string; text: string }
  | { kind: 'replace'; channelId: string; text: string }
  | { kind: 'clear'; channelId: string };

const listeners = new Set<Listener>();

export function subscribeComposerBus(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function emitComposerBus(action: ComposerBusAction): void {
  for (const l of listeners) l(action);
}
```

- [ ] **Step 2: Subscribe inside Composer**

Edit `src/renderer/components/Composer.tsx`. After the existing `useEffect` that wires gateway state (around line 74), add:

```ts
useEffect(() => {
  const off = subscribeComposerBus((action) => {
    if (action.channelId !== channelId) return;
    if (action.kind === 'append') setText(t => t + action.text);
    else if (action.kind === 'replace') setText(action.text);
    else if (action.kind === 'clear') setText('');
  });
  return off;
}, [channelId]);
```

Add the import at the top of the file:

```ts
import { subscribeComposerBus } from '../lib/composer-bus';
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/lib/composer-bus.ts src/renderer/components/Composer.tsx
git commit -m "feat(autonomy): composer-bus for draft injection"
```

---

## Task 14: Renderer — "Generate reply with Claude" message action

**Files:**
- Modify: `src/renderer/components/MessageGroup.tsx`

We're adding a context-menu item (no new icon needed beyond `IconWand` if available; use `IconSparkles` from `@tabler/icons-react`). The handler calls `window.botcord.autonomy.draftReply` and listens for streamed deltas to push into the composer-bus.

- [ ] **Step 1: Read current `buildMessageMenu` and the MessageGroup component**

Run: `cat src/renderer/components/MessageGroup.tsx | head -200` and locate `buildMessageMenu` and the per-message hover toolbar JSX. Note the existing icon import line at top.

- [ ] **Step 2: Add icon import and a handler factory**

Edit `src/renderer/components/MessageGroup.tsx`:

1. Add `IconSparkles` to the existing `@tabler/icons-react` import.
2. Add this helper near `buildMessageMenu`:

```ts
import { emitComposerBus } from '../lib/composer-bus';

function generateReplyWithClaude(channelId: string, messageId: string): void {
  void (async () => {
    const detect = await api.autonomy.detect();
    if (!detect.found) {
      pushToast('warn', `Claude CLI not available: ${detect.reason ?? 'unknown'}`);
      return;
    }
    const res = await api.autonomy.draftReply(channelId, messageId);
    if (!res.ok) { pushToast('danger', `Generate failed: ${res.error.message}`); return; }
    const requestId = res.data.requestId;
    emitComposerBus({ kind: 'replace', channelId, text: '' });
    const offDelta = api.events.onAutonomyDraftDelta(({ requestId: rid, delta }) => {
      if (rid !== requestId) return;
      emitComposerBus({ kind: 'append', channelId, text: delta });
    });
    const offDone = api.events.onAutonomyDraftDone(({ requestId: rid }) => {
      if (rid !== requestId) return;
      offDelta();
      offDone();
    });
  })();
}
```

3. In `buildMessageMenu` (around line 53), accept an extra `onGenerateClaudeReply?: () => void` parameter and add the menu item near the "Reply" entry:

```ts
items.push({
  type: 'item',
  label: 'Generate reply with Claude',
  onClick: onGenerateClaudeReply!,
  icon: <IconSparkles className={iconCls} />,
  disabled: !onGenerateClaudeReply,
});
```

(Place it conditionally so it appears only when the handler is provided.)

4. At the call site that builds the menu, pass:

```ts
onGenerateClaudeReply: () => generateReplyWithClaude(message.channelId, message.id),
```

5. In the per-message hover toolbar JSX (the row of icon buttons next to each message), add a button:

```tsx
<button
  className="p-1 rounded hover:bg-bg-sunken"
  title="Generate reply with Claude"
  onClick={() => generateReplyWithClaude(message.channelId, message.id)}
>
  <IconSparkles className="w-4 h-4 stroke-[1.75]" />
</button>
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: PASS (or fix any complaints).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/MessageGroup.tsx
git commit -m "feat(autonomy): 'Generate reply with Claude' action — drafts into composer"
```

---

## Task 15: Renderer — guild-level Autonomy settings tab

**Files:**
- Create: `src/renderer/components/AutonomySettingsTab.tsx`

This component is rendered inside whatever surface the codebase uses for guild settings. For first integration, expose it via the existing `SettingsPanel` (Task 16) or add it to a guild-context popover. Implement it standalone here so Task 16 can mount it.

- [ ] **Step 1: Create the component**

Create `src/renderer/components/AutonomySettingsTab.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { GuildAutonomyConfig, ChannelSummary } from '../../shared/domain';
import { pushToast } from './Toaster';

export function AutonomySettingsTab({ guildId }: { guildId: string }) {
  const [cfg, setCfg] = useState<GuildAutonomyConfig | null>(null);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [detect, setDetect] = useState<{ found: boolean; version?: string; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.autonomy.detect().then(setDetect);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.autonomy.getGuildConfig(guildId).then(r => { if (!cancelled && r.ok) setCfg(r.data); });
    api.guilds.listChannels(guildId).then(r => {
      if (!cancelled && r.ok) setChannels(r.data.filter(c => c.type === 'text'));
    });
    return () => { cancelled = true; };
  }, [guildId]);

  const textChannelsById = useMemo(() => new Map(channels.map(c => [c.id, c])), [channels]);

  if (!cfg) return <div className="text-sm text-fg-muted">Loading…</div>;

  const save = async (partial: Partial<Omit<GuildAutonomyConfig, 'guildId' | 'updatedAt'>>) => {
    setBusy(true);
    const res = await api.autonomy.setGuildConfig(guildId, partial);
    setBusy(false);
    if (res.ok) setCfg(res.data);
    else pushToast('danger', res.error.message);
  };

  const toggleChannel = (id: string) => {
    const next = cfg.channelIds.includes(id) ? cfg.channelIds.filter(x => x !== id) : [...cfg.channelIds, id];
    void save({ channelIds: next });
  };

  return (
    <div className="space-y-4">
      {detect && !detect.found && (
        <div className="rounded border border-warn/50 bg-warn/10 px-3 py-2 text-xs text-fg">
          <div className="font-medium">Claude CLI not detected</div>
          <div className="text-fg-muted">{detect.reason ?? 'Install the Claude CLI to enable autonomy.'}</div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cfg.enabled} onChange={e => save({ enabled: e.target.checked })} disabled={busy} />
        Enable autonomous replies in this server
      </label>

      <div>
        <div className="text-xs font-medium text-fg-muted mb-1">Channels (text only)</div>
        <div className="max-h-48 overflow-y-auto rounded border border-border bg-bg-sunken">
          {channels.length === 0 && <div className="px-3 py-2 text-xs text-fg-muted">No text channels visible to the bot.</div>}
          {channels.map(c => (
            <label key={c.id} className="flex items-center gap-2 px-3 py-1 text-sm hover:bg-hover cursor-pointer">
              <input type="checkbox" checked={cfg.channelIds.includes(c.id)} onChange={() => toggleChannel(c.id)} disabled={busy} />
              <span># {c.name}</span>
            </label>
          ))}
        </div>
      </div>

      <label className="block text-sm">
        <span className="block text-xs font-medium text-fg-muted mb-1">Context window (recent messages used as background)</span>
        <input
          type="number"
          min={5}
          max={100}
          value={cfg.contextSize}
          onChange={e => save({ contextSize: Math.max(5, Math.min(100, parseInt(e.target.value || '20', 10))) })}
          className="w-24 px-2 py-1 rounded bg-bg-sunken border border-border text-fg text-sm"
          disabled={busy}
        />
      </label>

      <label className="block text-sm">
        <span className="block text-xs font-medium text-fg-muted mb-1">Persona (system prompt — empty uses global default)</span>
        <textarea
          rows={6}
          value={cfg.systemPrompt ?? ''}
          onChange={e => setCfg({ ...cfg, systemPrompt: e.target.value })}
          onBlur={() => save({ systemPrompt: cfg.systemPrompt && cfg.systemPrompt.trim().length > 0 ? cfg.systemPrompt : null })}
          className="w-full px-2 py-1 rounded bg-bg-sunken border border-border text-fg text-sm"
          disabled={busy}
        />
      </label>

      <label className="block text-sm">
        <span className="block text-xs font-medium text-fg-muted mb-1">Cooldown (ms between auto-replies in same channel)</span>
        <input
          type="number"
          min={1000}
          step={500}
          value={cfg.cooldownMs}
          onChange={e => save({ cooldownMs: Math.max(1000, parseInt(e.target.value || '5000', 10)) })}
          className="w-32 px-2 py-1 rounded bg-bg-sunken border border-border text-fg text-sm"
          disabled={busy}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. (The component is standalone — no external mount yet.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/AutonomySettingsTab.tsx
git commit -m "feat(autonomy): guild-level autonomy settings tab"
```

---

## Task 16: Renderer — global Autonomy section in SettingsPanel

**Files:**
- Create: `src/renderer/components/GlobalAutonomySettings.tsx`
- Modify: `src/renderer/components/SettingsPanel.tsx`

- [ ] **Step 1: Create the global settings component**

Create `src/renderer/components/GlobalAutonomySettings.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { GlobalAutonomyConfig } from '../../shared/domain';
import { pushToast } from './Toaster';

export function GlobalAutonomySettings() {
  const [cfg, setCfg] = useState<GlobalAutonomyConfig | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.autonomy.getGlobalConfig().then(r => { if (r.ok) setCfg(r.data); });
  }, []);

  if (!cfg) return null;

  const save = async (partial: Partial<GlobalAutonomyConfig>) => {
    setBusy(true);
    const res = await api.autonomy.setGlobalConfig(partial);
    setBusy(false);
    if (res.ok) setCfg(res.data);
    else pushToast('danger', res.error.message);
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-fg">Autonomy</h3>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cfg.enabled} onChange={e => save({ enabled: e.target.checked })} disabled={busy} />
        Enable autonomy globally (kill switch)
      </label>
      <label className="block text-sm">
        <span className="block text-xs font-medium text-fg-muted mb-1">Default persona (used when a server has no override)</span>
        <textarea
          rows={5}
          value={cfg.systemPrompt}
          onChange={e => setCfg({ ...cfg, systemPrompt: e.target.value })}
          onBlur={() => save({ systemPrompt: cfg.systemPrompt })}
          className="w-full px-2 py-1 rounded bg-bg-sunken border border-border text-fg text-sm"
          disabled={busy}
        />
      </label>
      <label className="block text-sm">
        <span className="block text-xs font-medium text-fg-muted mb-1">Global rate cap (responses per minute)</span>
        <input
          type="number"
          min={1}
          max={120}
          value={cfg.rateCapPerMin}
          onChange={e => save({ rateCapPerMin: Math.max(1, Math.min(120, parseInt(e.target.value || '20', 10))) })}
          className="w-24 px-2 py-1 rounded bg-bg-sunken border border-border text-fg text-sm"
          disabled={busy}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Mount inside SettingsPanel**

Edit `src/renderer/components/SettingsPanel.tsx`. Add import:

```ts
import { GlobalAutonomySettings } from './GlobalAutonomySettings';
```

Insert the section above the "Reset bot token" block (around line 94):

```tsx
<div className="border-t border-border pt-4">
  <GlobalAutonomySettings />
</div>
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/GlobalAutonomySettings.tsx src/renderer/components/SettingsPanel.tsx
git commit -m "feat(autonomy): global autonomy section in SettingsPanel"
```

---

## Task 17: Mount per-guild Autonomy tab

**Files:**
- Modify: whichever component currently hosts per-guild settings (likely a context-menu entry on the server icon in `ServerRail.tsx`, or a new modal). Inspect first; if no per-guild settings surface exists, add a minimal one.

- [ ] **Step 1: Find the per-guild settings entry point**

Run: `grep -n "guildId" src/renderer/components/ServerRail.tsx | head -30` and inspect any "Server settings" / context menu actions. Pick the natural surface: either an existing modal or open `AutonomySettingsTab` in a new modal triggered from a server-rail context menu item.

- [ ] **Step 2: Add the menu item and modal**

If no surface exists, add a minimal pattern. Edit `src/renderer/components/ServerRail.tsx` to add a context-menu entry "Autonomy settings" that opens a modal containing `<AutonomySettingsTab guildId={guildId} />`. Reuse the existing modal pattern from `SettingsPanel.tsx`:

```tsx
{open && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
    <div className="bg-bg-subtle border border-border rounded-lg p-6 w-[32rem] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      <h2 className="text-lg font-semibold text-fg mb-4">Autonomy — {guildName}</h2>
      <AutonomySettingsTab guildId={guildId} />
      <button className="mt-4 w-full px-3 py-2 rounded border border-border text-fg hover:bg-bg-sunken" onClick={() => setOpen(false)}>Close</button>
    </div>
  </div>
)}
```

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ServerRail.tsx
git commit -m "feat(autonomy): mount per-guild autonomy settings"
```

---

## Task 18: Manual smoke test

**Files:** None (verification only).

The agent must run this against the live app. If you cannot run the desktop app (e.g. headless agent), report this explicitly — do not claim success.

- [ ] **Step 1: Build and run**

Run: `npm run dev`
Expected: app boots; existing Discord features work.

- [ ] **Step 2: Verify CLI detection UI**

If the `claude` CLI is installed: open guild Autonomy settings, confirm no warning banner.
If not installed: temporarily rename it on PATH; reload guild settings and confirm the warning banner with a reason string.

- [ ] **Step 3: Auto-reply path**

In a test guild, enable autonomy globally and per-guild, allowlist one channel. Mention the bot in that channel. Expected: bot replies as a normal Discord reply within ~10–30s.

- [ ] **Step 4: Cooldown path**

Mention the bot twice within 5 seconds. Expected: only the first mention triggers a reply; the second is silently dropped.

- [ ] **Step 5: Allowlist path**

Mention the bot in a non-allowlisted channel. Expected: no reply.

- [ ] **Step 6: Manual draft path**

In any channel (allowlisted or not), open the message context menu and pick "Generate reply with Claude". Expected: composer fills in with streamed text. User can edit and hit Enter to send. No auto-send.

- [ ] **Step 7: Kill switch**

Toggle global autonomy off in app settings. Mention the bot. Expected: no reply.

- [ ] **Step 8: Commit any fixes found during smoke**

If you find regressions, fix them under a new task. Otherwise:

```bash
git commit --allow-empty -m "test(autonomy): manual smoke checklist passed"
```

---

## Self-review checklist (run after writing the plan)

This section is for the plan author (you), not the implementing agent. The author has run it inline already; no action required during execution.

- ✅ Spec coverage: trigger logic (Task 12), context assembly (Task 5/11/12), data model (Tasks 2/3/10), IPC (Tasks 9/11), renderer UI (Tasks 13–17), throttling (Task 7), error handling (Tasks 6/8/11/12), testing (every task with logic), file-level change list (this section).
- ✅ Type consistency: `GuildAutonomyConfig`, `GlobalAutonomyConfig`, `AutonomyHost`, `AutonomySession`, `ChannelHistoryEntry`, `PromptInputs`, `AutonomyModule`, `AutonomyEvents` defined once and referenced consistently.
- ✅ Open spec items deliberately deferred: composer integration shape — the plan picks the simpler "stream into composer with `replace`-then-`append`" approach; user can iterate later.
- ✅ Default global system prompt finalized as `DEFAULT_GLOBAL_SYSTEM_PROMPT` in `src/shared/domain.ts`.
