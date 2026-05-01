# Direct Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Discord-style DMs surface to BotCord so admins can send/receive DMs through their bot, with Home button, conversation list, OS notifications, and offline-message backfill on reconnect.

**Architecture:** New "Home" view in the existing three-pane shell. DM channel index persisted to SQLite (messages stay live-fetched). New IPC namespace `dms.*`. ClientManager already broadcasts every `messageCreate` regardless of channel type, so a separate `dm-listener` only handles persistence + backfill — renderer event wiring already works.

**Tech Stack:** TypeScript, Electron, React, discord.js, better-sqlite3, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-01-direct-messages-design.md`

---

## File map

**Create:**
- `src/main/db/repos/dm-channels.ts` — DM channel repo
- `src/main/db/repos/__tests__/dm-channels.test.ts`
- `src/main/discord/dm-listener.ts` — gateway → persistence + backfill driver
- `src/main/discord/__tests__/dm-listener.test.ts`
- `src/main/ipc/dms.ts` — IPC handlers
- `src/renderer/components/DMList.tsx`
- `src/renderer/components/DMListItem.tsx`
- `src/renderer/components/NewDMModal.tsx`
- `src/renderer/components/__tests__/DMList.test.tsx`
- `src/renderer/components/__tests__/NewDMModal.test.tsx`

**Modify:**
- `src/main/db/migrations/index.ts` — add `M003_DMS`
- `src/main/discord/intents.ts` — add `DirectMessages`, `DirectMessageTyping`
- `src/main/ipc/index.ts` — register dms handlers
- `src/main/index.ts` — wire dm-listener
- `src/preload/expose.ts` — expose `api.dms.*`
- `src/shared/ipc-contract.ts` — add `dms` namespace + IPC channels + `DMChannelRow`/`Prefs.notifyOnDM`
- `src/shared/domain.ts` — `DMChannelRow` type
- `src/renderer/lib/api.ts` (or wherever `api.*` lives) — type re-export
- `src/renderer/lib/use-unreads.ts` — DM unreads + `markDMsRead`
- `src/renderer/components/ServerRail.tsx` — Home button at top
- `src/renderer/routes/shell/ShellRoute.tsx` — `view: 'home' | 'guild'` state
- `src/renderer/components/settings/sections/NotificationsSection.tsx` — `notifyOnDM` toggle
- `src/renderer/components/settings/types.ts` — settings shape
- `src/renderer/routes/onboarding/steps/Step3Intents.tsx` — copy update

---

## Task 1: Database migration for `dm_channels`

**Files:**
- Modify: `src/main/db/migrations/index.ts`

- [ ] **Step 1: Add migration constant and entry**

In `src/main/db/migrations/index.ts`, add a new migration after `M002_AUTONOMY` and append it to the `MIGRATIONS` array:

```ts
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
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/db/migrations/index.ts
git commit -m "feat(db): add dm_channels migration"
```

---

## Task 2: `DMChannelRow` shared domain type

**Files:**
- Modify: `src/shared/domain.ts`

- [ ] **Step 1: Add the type**

Add to `src/shared/domain.ts`:

```ts
export type DMChannelRow = {
  channelId: string;
  userId: string;
  userUsername: string;
  userGlobalName: string | null;
  userAvatar: string | null;
  lastMessageId: string | null;
  lastMessagePreview: string | null;
  inert: boolean;
  createdAt: number;
  updatedAt: number;
};

export type DMChannelUpsert = {
  channelId: string;
  userId: string;
  userUsername: string;
  userGlobalName: string | null;
  userAvatar: string | null;
  lastMessageId: string | null;
  lastMessagePreview: string | null;
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/shared/domain.ts
git commit -m "feat(domain): add DMChannelRow types"
```

---

## Task 3: DM channels repo — failing test

**Files:**
- Create: `src/main/db/repos/__tests__/dm-channels.test.ts`

Look at `src/main/db/repos/__tests__/` for an existing repo test to mirror the in-memory database setup pattern.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { MIGRATIONS } from '../../migrations';
import { createDMChannelsRepo } from '../dm-channels';

function makeDb(): DB {
  const db = new Database(':memory:');
  for (const m of MIGRATIONS) db.exec(m.sql);
  return db;
}

describe('dm-channels repo', () => {
  let db: DB;
  beforeEach(() => { db = makeDb(); });

  it('upserts a new row and returns it', () => {
    const repo = createDMChannelsRepo(db);
    const row = repo.upsert({
      channelId: 'c1',
      userId: 'u1',
      userUsername: 'alice',
      userGlobalName: 'Alice',
      userAvatar: 'https://cdn/x.png',
      lastMessageId: 'm1',
      lastMessagePreview: 'hi',
    });
    expect(row.channelId).toBe('c1');
    expect(row.userUsername).toBe('alice');
    expect(row.inert).toBe(false);
    expect(row.createdAt).toBeGreaterThan(0);
    expect(row.updatedAt).toBe(row.createdAt);
  });

  it('upsert updates existing row, preserves createdAt, bumps updatedAt', async () => {
    const repo = createDMChannelsRepo(db);
    const first = repo.upsert({
      channelId: 'c1', userId: 'u1', userUsername: 'alice',
      userGlobalName: null, userAvatar: null,
      lastMessageId: 'm1', lastMessagePreview: 'hi',
    });
    await new Promise(r => setTimeout(r, 5));
    const second = repo.upsert({
      channelId: 'c1', userId: 'u1', userUsername: 'alice',
      userGlobalName: null, userAvatar: null,
      lastMessageId: 'm2', lastMessagePreview: 'hello again',
    });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(second.lastMessageId).toBe('m2');
    expect(second.lastMessagePreview).toBe('hello again');
  });

  it('list orders by updatedAt DESC and excludes inert by default', async () => {
    const repo = createDMChannelsRepo(db);
    repo.upsert({ channelId: 'a', userId: 'ua', userUsername: 'a', userGlobalName: null, userAvatar: null, lastMessageId: null, lastMessagePreview: null });
    await new Promise(r => setTimeout(r, 5));
    repo.upsert({ channelId: 'b', userId: 'ub', userUsername: 'b', userGlobalName: null, userAvatar: null, lastMessageId: null, lastMessagePreview: null });
    await new Promise(r => setTimeout(r, 5));
    repo.upsert({ channelId: 'c', userId: 'uc', userUsername: 'c', userGlobalName: null, userAvatar: null, lastMessageId: null, lastMessagePreview: null });
    repo.markInert('b');

    const list = repo.list();
    expect(list.map(r => r.channelId)).toEqual(['c', 'a']);

    const all = repo.list({ includeInert: true });
    expect(all.map(r => r.channelId)).toEqual(['c', 'a', 'b']);
  });

  it('get returns null when missing', () => {
    const repo = createDMChannelsRepo(db);
    expect(repo.get('nope')).toBeNull();
  });

  it('markInert flips the inert flag', () => {
    const repo = createDMChannelsRepo(db);
    repo.upsert({ channelId: 'x', userId: 'u', userUsername: 'x', userGlobalName: null, userAvatar: null, lastMessageId: null, lastMessagePreview: null });
    repo.markInert('x');
    const row = repo.get('x');
    expect(row?.inert).toBe(true);
  });
});
```

- [ ] **Step 2: Run test (expected to fail — module missing)**

Run: `npx vitest run src/main/db/repos/__tests__/dm-channels.test.ts`
Expected: FAIL — "Cannot find module" or similar.

- [ ] **Step 3: Commit**

```bash
git add src/main/db/repos/__tests__/dm-channels.test.ts
git commit -m "test(db): add failing dm-channels repo tests"
```

---

## Task 4: DM channels repo — implementation

**Files:**
- Create: `src/main/db/repos/dm-channels.ts`

- [ ] **Step 1: Implement the repo**

```ts
import type { Database as DB } from 'better-sqlite3';
import type { DMChannelRow, DMChannelUpsert } from '../../../shared/domain';

type Row = {
  channel_id: string;
  user_id: string;
  user_username: string;
  user_global_name: string | null;
  user_avatar: string | null;
  last_message_id: string | null;
  last_message_preview: string | null;
  inert: number;
  created_at: number;
  updated_at: number;
};

const toDomain = (r: Row): DMChannelRow => ({
  channelId: r.channel_id,
  userId: r.user_id,
  userUsername: r.user_username,
  userGlobalName: r.user_global_name,
  userAvatar: r.user_avatar,
  lastMessageId: r.last_message_id,
  lastMessagePreview: r.last_message_preview,
  inert: r.inert === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface DMChannelsRepo {
  list(opts?: { includeInert?: boolean }): DMChannelRow[];
  get(channelId: string): DMChannelRow | null;
  upsert(input: DMChannelUpsert): DMChannelRow;
  markInert(channelId: string): void;
  markRead(channelId: string): void;
}

export function createDMChannelsRepo(db: DB): DMChannelsRepo {
  const getStmt = db.prepare('SELECT * FROM dm_channels WHERE channel_id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO dm_channels (
      channel_id, user_id, user_username, user_global_name, user_avatar,
      last_message_id, last_message_preview, inert, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE dm_channels
       SET user_id = ?, user_username = ?, user_global_name = ?, user_avatar = ?,
           last_message_id = ?, last_message_preview = ?, updated_at = ?
     WHERE channel_id = ?
  `);
  const listAllStmt = db.prepare('SELECT * FROM dm_channels ORDER BY updated_at DESC');
  const listActiveStmt = db.prepare('SELECT * FROM dm_channels WHERE inert = 0 ORDER BY updated_at DESC');
  const markInertStmt = db.prepare('UPDATE dm_channels SET inert = 1, updated_at = ? WHERE channel_id = ?');

  return {
    list(opts) {
      const rows = (opts?.includeInert ? listAllStmt.all() : listActiveStmt.all()) as Row[];
      return rows.map(toDomain);
    },

    get(channelId) {
      const row = getStmt.get(channelId) as Row | undefined;
      return row ? toDomain(row) : null;
    },

    upsert(input) {
      const now = Date.now();
      const existing = getStmt.get(input.channelId) as Row | undefined;
      if (existing) {
        updateStmt.run(
          input.userId, input.userUsername, input.userGlobalName, input.userAvatar,
          input.lastMessageId, input.lastMessagePreview, now, input.channelId,
        );
      } else {
        insertStmt.run(
          input.channelId, input.userId, input.userUsername, input.userGlobalName, input.userAvatar,
          input.lastMessageId, input.lastMessagePreview, now, now,
        );
      }
      return toDomain(getStmt.get(input.channelId) as Row);
    },

    markInert(channelId) {
      markInertStmt.run(Date.now(), channelId);
    },

    markRead(_channelId) {
      // Unread state is tracked client-side via prefs (channelLastSeen).
      // This is a placeholder hook for future server-side read receipts.
    },
  };
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/main/db/repos/__tests__/dm-channels.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 3: Commit**

```bash
git add src/main/db/repos/dm-channels.ts
git commit -m "feat(db): implement dm-channels repo"
```

---

## Task 5: Add DM gateway intents

**Files:**
- Modify: `src/main/discord/intents.ts`

- [ ] **Step 1: Add intents**

```ts
import { GatewayIntentBits } from 'discord.js';

export const REQUIRED_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildPresences,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildMessagePolls,
  GatewayIntentBits.GuildMessageTyping,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.DirectMessageTyping,
];
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/discord/intents.ts
git commit -m "feat(discord): enable DirectMessages intents"
```

---

## Task 6: DM listener — failing test

**Files:**
- Create: `src/main/discord/__tests__/dm-listener.test.ts`

The listener subscribes to a discord.js Client's events. Mock the client as a small EventEmitter and assert that messageCreate on a DM channel results in a repo upsert.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { MIGRATIONS } from '../../db/migrations';
import { createDMChannelsRepo } from '../../db/repos/dm-channels';
import { attachDMListener } from '../dm-listener';
import { Events, ChannelType } from 'discord.js';

function makeDb(): DB {
  const db = new Database(':memory:');
  for (const m of MIGRATIONS) db.exec(m.sql);
  return db;
}

function dmMessage(overrides: Partial<{ id: string; content: string; userId: string; username: string; channelId: string }> = {}) {
  return {
    id: overrides.id ?? 'm1',
    content: overrides.content ?? 'hello',
    channelId: overrides.channelId ?? 'c1',
    author: {
      id: overrides.userId ?? 'u1',
      bot: false,
      username: overrides.username ?? 'alice',
      globalName: 'Alice',
      displayAvatarURL: () => 'https://cdn/avatar.png',
    },
    channel: { type: ChannelType.DM, id: overrides.channelId ?? 'c1' },
  };
}

describe('attachDMListener', () => {
  let db: DB;
  let client: EventEmitter & { user: { id: string } };

  beforeEach(() => {
    db = makeDb();
    client = Object.assign(new EventEmitter(), { user: { id: 'bot1' } });
  });

  it('upserts a row when a DM messageCreate fires', () => {
    const repo = createDMChannelsRepo(db);
    attachDMListener(client as never, repo);
    client.emit(Events.MessageCreate, dmMessage({ content: 'hello world' }));
    const row = repo.get('c1');
    expect(row).not.toBeNull();
    expect(row!.userId).toBe('u1');
    expect(row!.userUsername).toBe('alice');
    expect(row!.lastMessageId).toBe('m1');
    expect(row!.lastMessagePreview).toBe('hello world');
  });

  it('ignores non-DM messages', () => {
    const repo = createDMChannelsRepo(db);
    attachDMListener(client as never, repo);
    const guildMsg = dmMessage();
    guildMsg.channel = { type: ChannelType.GuildText, id: 'g1' } as never;
    client.emit(Events.MessageCreate, guildMsg);
    expect(repo.list()).toHaveLength(0);
  });

  it('truncates preview to 200 chars', () => {
    const repo = createDMChannelsRepo(db);
    attachDMListener(client as never, repo);
    client.emit(Events.MessageCreate, dmMessage({ content: 'x'.repeat(500) }));
    const row = repo.get('c1');
    expect(row!.lastMessagePreview!.length).toBeLessThanOrEqual(200);
  });

  it('marks channel inert when fetch returns Unknown Channel during backfill', async () => {
    const repo = createDMChannelsRepo(db);
    repo.upsert({
      channelId: 'c1', userId: 'u1', userUsername: 'alice',
      userGlobalName: null, userAvatar: null,
      lastMessageId: 'm0', lastMessagePreview: 'old',
    });
    const c = Object.assign(new EventEmitter(), {
      user: { id: 'bot1' },
      channels: { fetch: vi.fn(async () => { const e: any = new Error('Unknown Channel'); e.code = 10003; throw e; }) },
    });
    const { runBackfill } = attachDMListener(c as never, repo);
    await runBackfill();
    expect(repo.get('c1')!.inert).toBe(true);
  });
});
```

- [ ] **Step 2: Run test (expected to fail)**

Run: `npx vitest run src/main/discord/__tests__/dm-listener.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Commit**

```bash
git add src/main/discord/__tests__/dm-listener.test.ts
git commit -m "test(discord): add failing dm-listener tests"
```

---

## Task 7: DM listener — implementation

**Files:**
- Create: `src/main/discord/dm-listener.ts`

- [ ] **Step 1: Implement the listener**

```ts
import { Events, ChannelType } from 'discord.js';
import type { Client, Message, DMChannel } from 'discord.js';
import type { DMChannelsRepo } from '../db/repos/dm-channels';

const MAX_PREVIEW = 200;
const BACKFILL_CONCURRENCY = 4;
const BACKFILL_PAGE_SIZE = 100;

const isDM = (m: { channel?: { type?: number } }): boolean =>
  m.channel?.type === ChannelType.DM;

const previewOf = (content: string, hasAttachments: boolean, hasEmbeds: boolean): string => {
  const trimmed = content.trim();
  if (trimmed.length > 0) return trimmed.slice(0, MAX_PREVIEW);
  if (hasAttachments) return '[attachment]';
  if (hasEmbeds) return '[embed]';
  return '';
};

function upsertFromMessage(repo: DMChannelsRepo, m: Message): void {
  const author = m.author as unknown as { id: string; bot: boolean; username: string; globalName: string | null; displayAvatarURL: (o?: { size: number }) => string };
  // The "other side" of a DM channel: if the bot sent the message, the
  // recipient comes from the DM channel's `recipient`; otherwise it's the author.
  const channel = m.channel as DMChannel;
  const recipient = author.bot
    ? (channel.recipient ?? null)
    : author;
  if (!recipient) return;
  const r = recipient as unknown as { id: string; username: string; globalName: string | null; displayAvatarURL: (o?: { size: number }) => string };

  repo.upsert({
    channelId: m.channelId,
    userId: r.id,
    userUsername: r.username,
    userGlobalName: r.globalName ?? null,
    userAvatar: r.displayAvatarURL({ size: 128 }),
    lastMessageId: m.id,
    lastMessagePreview: previewOf(
      m.content ?? '',
      (m.attachments?.size ?? 0) > 0,
      (m.embeds?.length ?? 0) > 0,
    ),
  });
}

export function attachDMListener(client: Client, repo: DMChannelsRepo): { runBackfill: () => Promise<void> } {
  client.on(Events.MessageCreate, (m: Message) => {
    if (!isDM(m)) return;
    upsertFromMessage(repo, m);
  });

  client.on(Events.MessageUpdate, (_old, mNew) => {
    const m = mNew as Message;
    if (m.partial) {
      m.fetch().then(full => { if (isDM(full)) upsertFromMessage(repo, full); }).catch(() => { /* ignore */ });
      return;
    }
    if (!isDM(m)) return;
    upsertFromMessage(repo, m);
  });

  const runBackfill = async (): Promise<void> => {
    const rows = repo.list();
    let cursor = 0;
    const workers = Array.from({ length: BACKFILL_CONCURRENCY }, async () => {
      while (cursor < rows.length) {
        const idx = cursor++;
        const row = rows[idx]!;
        try {
          const ch = await client.channels.fetch(row.channelId).catch((e: { code?: number } | Error) => {
            const code = (e as { code?: number }).code;
            if (code === 10003) {
              repo.markInert(row.channelId);
              return null;
            }
            throw e;
          });
          if (!ch || ch.type !== ChannelType.DM) continue;
          const dm = ch as DMChannel;
          let after = row.lastMessageId ?? undefined;
          // Page until empty. Bounded loop count guards against pathological cases.
          for (let i = 0; i < 50; i++) {
            const opts: { limit: number; after?: string } = { limit: BACKFILL_PAGE_SIZE };
            if (after) opts.after = after;
            const messages = await dm.messages.fetch(opts);
            if (messages.size === 0) break;
            // Discord returns newest-first; iterate oldest-first so upserts land in order.
            const ordered = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            for (const m of ordered) {
              if (isDM(m)) upsertFromMessage(repo, m);
              client.emit(Events.MessageCreate, m);
            }
            const newest = ordered[ordered.length - 1]!;
            after = newest.id;
            if (messages.size < BACKFILL_PAGE_SIZE) break;
          }
        } catch (e) {
          // Logged but never blocks readiness; will retry on next ready.
          console.warn('[dm-listener] backfill failed for', row.channelId, e);
        }
      }
    });
    await Promise.all(workers);
  };

  return { runBackfill };
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/main/discord/__tests__/dm-listener.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 3: Commit**

```bash
git add src/main/discord/dm-listener.ts
git commit -m "feat(discord): add DM listener with backfill"
```

---

## Task 8: IPC contract — add `dms` namespace

**Files:**
- Modify: `src/shared/ipc-contract.ts`

- [ ] **Step 1: Add the `dms` interface, channel keys, and `Prefs.notifyOnDM`**

Add these inside the `BotcordApi` interface, alongside the other namespaces:

```ts
  dms: {
    list(opts?: { includeInert?: boolean }): Promise<Result<DMChannelRow[]>>;
    fetchMessages(channelId: string, opts: { before?: string; limit: number }): Promise<Result<MessageSummary[]>>;
    openWithUser(userId: string): Promise<Result<DMChannelRow>>;
    send(channelId: string, content: string, opts?: { replyToMessageId?: string }): Promise<Result<MessageSummary>>;
    sendWithAttachments(channelId: string, content: string, attachments: SendAttachment[]): Promise<Result<MessageSummary>>;
    markRead(channelId: string): Promise<Result<void>>;
    close(channelId: string): Promise<Result<void>>;
  };
```

Add `DMChannelRow` to the existing import from `./domain`.

Add to `IPC_CHANNELS`:

```ts
  'dms.list': 'dms.list',
  'dms.fetchMessages': 'dms.fetchMessages',
  'dms.openWithUser': 'dms.openWithUser',
  'dms.send': 'dms.send',
  'dms.sendWithAttachments': 'dms.sendWithAttachments',
  'dms.markRead': 'dms.markRead',
  'dms.close': 'dms.close',
```

If `Prefs` is defined in this file (or in `domain.ts`), add `notifyOnDM?: boolean`. Locate it via `git grep "type Prefs" src/shared` and edit accordingly.

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/shared/ipc-contract.ts src/shared/domain.ts
git commit -m "feat(ipc): add dms namespace + notifyOnDM pref"
```

---

## Task 9: IPC handlers — `src/main/ipc/dms.ts`

**Files:**
- Create: `src/main/ipc/dms.ts`
- Modify: `src/main/ipc/index.ts`

- [ ] **Step 1: Implement handlers**

```ts
import { ipcMain } from 'electron';
import { ChannelType, AttachmentBuilder, type DMChannel, type Message } from 'discord.js';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { DMChannelRow, MessageSummary, SendAttachment } from '../../shared/domain';
import { summarizeMessage } from '../discord/client-manager';
import type { DMChannelsRepo } from '../db/repos/dm-channels';
import type { IpcDeps } from './index';

export type DMIpcDeps = IpcDeps & { dmRepo: DMChannelsRepo };

const requireDM = async (manager: IpcDeps['manager'], channelId: string): Promise<{ ok: true; channel: DMChannel } | Result<never>> => {
  const client = manager.getClient();
  if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.DM) return err('NOT_FOUND', `DM channel ${channelId} not found`);
  return { ok: true, channel: ch as DMChannel };
};

export function registerDMHandlers({ manager, dmRepo }: DMIpcDeps): void {
  ipcMain.handle(IPC_CHANNELS['dms.list'], async (_, opts: unknown): Promise<Result<DMChannelRow[]>> => {
    const includeInert = !!(opts && typeof opts === 'object' && (opts as { includeInert?: boolean }).includeInert);
    return ok(dmRepo.list({ includeInert }));
  });

  ipcMain.handle(IPC_CHANNELS['dms.fetchMessages'], async (_, channelId: unknown, opts: unknown): Promise<Result<MessageSummary[]>> => {
    if (typeof channelId !== 'string' || typeof opts !== 'object' || opts === null) return err('INTERNAL', 'invalid arguments');
    const o = opts as { before?: string; limit: number };
    if (typeof o.limit !== 'number' || o.limit < 1 || o.limit > 100) return err('INTERNAL', 'limit must be 1-100');
    const got = await requireDM(manager, channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary[]>;
    try {
      const fetchOpts: { limit: number; before?: string } = { limit: o.limit };
      if (o.before) fetchOpts.before = o.before;
      const messages = await (got as { ok: true; channel: DMChannel }).channel.messages.fetch(fetchOpts);
      return ok(Array.from(messages.values()).map(summarizeMessage));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['dms.openWithUser'], async (_, userId: unknown): Promise<Result<DMChannelRow>> => {
    if (typeof userId !== 'string') return err('INTERNAL', 'userId required');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    try {
      const user = await client.users.fetch(userId);
      const dm = await user.createDM();
      const row = dmRepo.upsert({
        channelId: dm.id,
        userId: user.id,
        userUsername: user.username,
        userGlobalName: (user as unknown as { globalName: string | null }).globalName,
        userAvatar: user.displayAvatarURL({ size: 128 }),
        lastMessageId: null,
        lastMessagePreview: null,
      });
      return ok(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/cannot send/i.test(msg) || /50007/.test(msg)) {
        return err('MISSING_PERMISSIONS', 'User has DMs disabled or shares no guilds with the bot');
      }
      return err('DISCORD_HTTP_ERROR', msg);
    }
  });

  ipcMain.handle(IPC_CHANNELS['dms.send'], async (_, channelId: unknown, content: unknown, opts: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof content !== 'string') return err('INTERNAL', 'invalid arguments');
    const got = await requireDM(manager, channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    const sendOpts: { content: string; reply?: { messageReference: string; failIfNotExists: boolean } } = { content };
    const r = (opts && typeof opts === 'object') ? (opts as { replyToMessageId?: unknown }).replyToMessageId : undefined;
    if (typeof r === 'string' && r) sendOpts.reply = { messageReference: r, failIfNotExists: false };
    try {
      const msg = await (got as { ok: true; channel: DMChannel }).channel.send(sendOpts);
      return ok(summarizeMessage(msg as Message));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['dms.sendWithAttachments'], async (_, channelId: unknown, content: unknown, attachments: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof content !== 'string' || !Array.isArray(attachments)) return err('INTERNAL', 'invalid arguments');
    const got = await requireDM(manager, channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    let files: AttachmentBuilder[];
    try {
      files = (attachments as SendAttachment[]).map((a, i) => {
        if (typeof a?.name !== 'string' || !(a.bytes instanceof Uint8Array)) throw new Error(`attachments[${i}] is malformed`);
        return new AttachmentBuilder(Buffer.from(a.bytes), { name: a.name });
      });
    } catch (e) {
      return err('INTERNAL', e instanceof Error ? e.message : String(e));
    }
    try {
      const msg = await (got as { ok: true; channel: DMChannel }).channel.send({ content: content || undefined, files });
      return ok(summarizeMessage(msg as Message));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['dms.markRead'], async (_, channelId: unknown): Promise<Result<void>> => {
    if (typeof channelId !== 'string') return err('INTERNAL', 'channelId required');
    dmRepo.markRead(channelId);
    return ok(undefined);
  });

  ipcMain.handle(IPC_CHANNELS['dms.close'], async (_, channelId: unknown): Promise<Result<void>> => {
    if (typeof channelId !== 'string') return err('INTERNAL', 'channelId required');
    dmRepo.markInert(channelId);
    return ok(undefined);
  });
}
```

- [ ] **Step 2: Wire registration in `src/main/ipc/index.ts`**

Add the import and call. Update `IpcDeps` to include `dmRepo`:

```ts
import { registerDMHandlers } from './dms';
import type { DMChannelsRepo } from '../db/repos/dm-channels';

export type IpcDeps = {
  vault: TokenVault;
  manager: ClientManager;
  db: DB;
  dmRepo: DMChannelsRepo;
};

// ... inside registerAllIpc:
  registerDMHandlers(deps);
```

- [ ] **Step 3: Construct repo + pass through in `src/main/index.ts`**

Locate where `registerAllIpc` is called. Add:

```ts
import { createDMChannelsRepo } from './db/repos/dm-channels';
// ...
const dmRepo = createDMChannelsRepo(db);
// pass `dmRepo` into the deps object given to registerAllIpc
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/dms.ts src/main/ipc/index.ts src/main/index.ts
git commit -m "feat(ipc): add dms handlers"
```

---

## Task 10: Wire DM listener + backfill on ready in `src/main/index.ts`

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Attach listener after client connect, run backfill on ready**

Locate where the `ClientManager` is connected (search for `manager.connect`). After a successful connect, hook up:

```ts
import { attachDMListener } from './discord/dm-listener';
// ...
const client = manager.getClient();
if (client) {
  const dm = attachDMListener(client, dmRepo);
  client.on('ready', () => { void dm.runBackfill(); });
  // Also retrigger after gateway reconnects.
  client.on('shardResume', () => { void dm.runBackfill(); });
}
```

If `manager.connect` is called multiple times in this file's lifecycle, factor the wiring so it runs each time a fresh client is created. (Read the surrounding code; mirror the existing pattern for connect-time wiring such as voice/autonomy.)

- [ ] **Step 2: Type-check + run all tests**

Run: `npx tsc -p tsconfig.json --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): wire dm listener + backfill on ready"
```

---

## Task 11: Preload — expose `api.dms.*`

**Files:**
- Modify: `src/preload/expose.ts`

- [ ] **Step 1: Add the `dms` namespace to the exposed API**

Read `src/preload/expose.ts`. Mirror the existing `messages` namespace, replacing each call with the corresponding `dms.*` IPC channel. Each method calls `ipcRenderer.invoke(IPC_CHANNELS['dms.<name>'], ...args)`.

```ts
  dms: {
    list: (opts) => ipcRenderer.invoke(IPC_CHANNELS['dms.list'], opts),
    fetchMessages: (channelId, opts) => ipcRenderer.invoke(IPC_CHANNELS['dms.fetchMessages'], channelId, opts),
    openWithUser: (userId) => ipcRenderer.invoke(IPC_CHANNELS['dms.openWithUser'], userId),
    send: (channelId, content, opts) => ipcRenderer.invoke(IPC_CHANNELS['dms.send'], channelId, content, opts),
    sendWithAttachments: (channelId, content, attachments) => ipcRenderer.invoke(IPC_CHANNELS['dms.sendWithAttachments'], channelId, content, attachments),
    markRead: (channelId) => ipcRenderer.invoke(IPC_CHANNELS['dms.markRead'], channelId),
    close: (channelId) => ipcRenderer.invoke(IPC_CHANNELS['dms.close'], channelId),
  },
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS — `BotcordApi` interface satisfied.

- [ ] **Step 3: Commit**

```bash
git add src/preload/expose.ts
git commit -m "feat(preload): expose dms api"
```

---

## Task 12: Renderer — extend `useUnreads` for DMs

**Files:**
- Modify: `src/renderer/lib/use-unreads.ts`

- [ ] **Step 1: Add DM state**

The existing `useUnreads` is channel-keyed and routes through `messageCreate`. The bot is always recipient in a DM, so every non-bot DM message should count as a mention.

Add a `Set<string>` ref `dmChannels` (loaded from `api.dms.list()` on mount and updated when a `messageCreate` arrives in a channel without a `guildId`). Inside the `messageCreate` handler, if `!message.guildId` and `dmChannels.has(channelId)` and the message author is not the bot, treat the message as a mention (force-add to `mentionMsgs`).

Add to the return type:
```ts
  dmUnreadChannelIds: Set<string>;
  dmMentionCount: number;
  markDMsRead: () => void;
```

`dmUnreadChannelIds` = subset of `channelIds` where `dmChannels.has(cid)`.
`dmMentionCount` = sum of mention counts across DM channels.
`markDMsRead()` walks `dmChannels` and sets `lastSeen` like `markGuildRead` does for guild channels.

- [ ] **Step 2: Load + maintain the DM channel set**

```ts
const dmChannels = useRef<Set<string>>(new Set());

useEffect(() => {
  let cancelled = false;
  api.dms.list().then(res => {
    if (!res.ok || cancelled) return;
    for (const r of res.data) dmChannels.current.add(r.channelId);
    force(n => n + 1);
  });
  return () => { cancelled = true; };
}, []);
```

In the `messageCreate` handler, when `!message.guildId`, also add `channelId` to `dmChannels.current`. (DM channels can be discovered live.)

In the mention-counting block, add: when `dmChannels.current.has(channelId)` and `message.authorId !== botIdRef.current`, treat as a mention.

- [ ] **Step 3: Compute new derived values**

```ts
const dmUnreadChannelIds = new Set<string>();
let dmMentionCount = 0;
for (const cid of channelIds) if (dmChannels.current.has(cid)) dmUnreadChannelIds.add(cid);
for (const cid of dmUnreadChannelIds) dmMentionCount += mentionChannelCounts.get(cid) ?? 0;
```

Add `markDMsRead`:

```ts
const markDMsRead = () => {
  const now = Date.now();
  let changed = false;
  for (const cid of dmChannels.current) {
    const mentions = mentionMsgs.current.get(cid);
    let maxMention = 0;
    if (mentions) for (const ts of mentions.values()) if (ts > maxMention) maxMention = ts;
    const ts = Math.max(latest.current.get(cid) ?? 0, maxMention, now);
    lastSeen.current.set(cid, ts);
    mentionMsgs.current.delete(cid);
    changed = true;
  }
  if (changed) {
    if (loaded.current) persistLastSeen();
    force(n => n + 1);
  }
};
```

Return alongside existing fields. Bot's own outgoing DMs already won't increment unread because they update `latest` and the active channel already auto-marks read; the explicit `authorId !== botIdRef.current` check above just keeps mention-count clean.

- [ ] **Step 4: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/use-unreads.ts
git commit -m "feat(unreads): track DM channels + dmMentionCount"
```

---

## Task 13: ServerRail — Home button at top

**Files:**
- Modify: `src/renderer/components/ServerRail.tsx`

- [ ] **Step 1: Add Home button before the guild list, with badge**

Read the current `ServerRail.tsx` to identify how guild tiles, active state, and badges are rendered. Mirror that, then add the Home button as the first child. Use the existing botcord assets:

- Inactive bg: `bg-zinc-700` (or whatever the existing rail background is + `hover:brightness-110`)
- Active bg: brand green `#007f68` (use a Tailwind arbitrary value `bg-[#007f68]`)
- Glyph: `<img src="/botcord-white.svg" />` — the file is in `public/`

```tsx
type HomeButtonProps = {
  active: boolean;
  unread: boolean;
  mentionCount: number;
  onClick: () => void;
};

function HomeButton({ active, unread, mentionCount, onClick }: HomeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Direct messages"
      className={
        'relative flex h-12 w-12 items-center justify-center rounded-2xl transition-colors ' +
        (active ? 'bg-[#007f68]' : 'bg-zinc-700 hover:bg-zinc-600')
      }
    >
      <img src="/botcord-white.svg" alt="" className="h-6 w-6" draggable={false} />
      {/* Active selection pill — match the existing pill used for guild tiles */}
      {active && <span className="absolute -left-2 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r bg-white" />}
      {!active && unread && mentionCount === 0 && (
        <span className="absolute -left-2 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r bg-zinc-200" />
      )}
      {mentionCount > 0 && (
        <span className="absolute -bottom-0.5 -right-0.5 min-w-[16px] rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white text-center">
          {mentionCount > 99 ? '99+' : mentionCount}
        </span>
      )}
    </button>
  );
}
```

(If the existing rail uses a different selection-pill class or red-badge pattern, copy that exactly instead of the snippet above.)

- [ ] **Step 2: Add props to ServerRail and render at top**

The rail's caller (`ShellRoute`) will pass:
```ts
homeActive: boolean;
homeUnread: boolean;
homeMentionCount: number;
onHomeClick: () => void;
```

Render the `HomeButton` before the divider and guild list. Keep an existing divider between Home and the first guild.

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ServerRail.tsx
git commit -m "feat(rail): add Home button with active/unread/mention states"
```

---

## Task 14: ShellRoute — `view: 'home' | 'guild'` state

**Files:**
- Modify: `src/renderer/routes/shell/ShellRoute.tsx`

- [ ] **Step 1: Add view state and Home routing**

Read the existing `ShellRoute.tsx`. Add:

```ts
const [view, setView] = useState<'home' | 'guild'>('guild');
const [activeDMChannelId, setActiveDMChannelId] = useState<string | null>(null);
```

Wire `ServerRail` props:
```ts
<ServerRail
  // ...existing props
  homeActive={view === 'home'}
  homeUnread={unreads.dmUnreadChannelIds.size > 0}
  homeMentionCount={unreads.dmMentionCount}
  onHomeClick={() => setView('home')}
/>
```

When a guild is clicked, set `setView('guild')`.

When `view === 'home'`:
- Middle pane: render `<DMList activeChannelId={activeDMChannelId} onSelect={setActiveDMChannelId} />`
- Right pane: if `activeDMChannelId` → reuse `<MessageList channelId={activeDMChannelId} />` + `<Composer channelId={activeDMChannelId} mode="dm" />` + DM header (avatar + display name from the `DMChannelRow`). If null → `<WelcomePane>` or an empty state.

The active channel for `useUnreads` should be `view === 'home' ? activeDMChannelId : activeGuildChannelId`.

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS — note `<DMList>` not yet implemented; this task may temporarily fail compile until Task 15. If so, add a stub:

```tsx
function DMList(_: { activeChannelId: string | null; onSelect: (id: string) => void }) { return null; }
```
…and remove the stub when Task 15 lands.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/routes/shell/ShellRoute.tsx
git commit -m "feat(shell): add home view routing"
```

---

## Task 15: `<DMListItem>` and `<DMList>`

**Files:**
- Create: `src/renderer/components/DMList.tsx`
- Create: `src/renderer/components/DMListItem.tsx`

- [ ] **Step 1: Implement `<DMListItem>`**

```tsx
import { Avatar } from './Avatar';
import type { DMChannelRow } from '@/shared/domain';

export function DMListItem({
  row, active, unread, mentionCount, onClick,
}: {
  row: DMChannelRow;
  active: boolean;
  unread: boolean;
  mentionCount: number;
  onClick: () => void;
}) {
  const displayName = row.userGlobalName ?? row.userUsername;
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ' +
        (active ? 'bg-zinc-700' : 'hover:bg-zinc-800')
      }
    >
      <Avatar src={row.userAvatar} alt={displayName} size={32} />
      <div className="min-w-0 flex-1">
        <div className={'truncate text-sm ' + (active ? 'text-white' : unread ? 'text-white' : 'text-zinc-400')}>{displayName}</div>
        {row.lastMessagePreview && (
          <div className="truncate text-xs text-zinc-500">{row.lastMessagePreview}</div>
        )}
      </div>
      {mentionCount > 0 && (
        <span className="min-w-[18px] rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-[18px] text-white text-center">
          {mentionCount > 99 ? '99+' : mentionCount}
        </span>
      )}
    </button>
  );
}
```

(Verify `Avatar` accepts `size` and `src/alt` — adjust prop names if not.)

- [ ] **Step 2: Implement `<DMList>`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { DMChannelRow, MessageSummary } from '@/shared/domain';
import { DMListItem } from './DMListItem';
import { NewDMModal } from './NewDMModal';
import { useUnreads } from '@/lib/use-unreads';

export function DMList({
  activeChannelId,
  onSelect,
}: {
  activeChannelId: string | null;
  onSelect: (channelId: string) => void;
}) {
  const [rows, setRows] = useState<DMChannelRow[]>([]);
  const [query, setQuery] = useState('');
  const [showNewDM, setShowNewDM] = useState(false);
  const unreads = useUnreads(activeChannelId);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const res = await api.dms.list();
      if (!cancelled && res.ok) setRows(res.data);
    };
    refresh();
    const offCreate = api.events.onMessageCreate(({ channelId, message }) => {
      if (message.guildId) return;
      // A DM message arrived — refresh list to pick up new rows / reorder.
      refresh();
    });
    return () => { cancelled = true; offCreate(); };
  }, []);

  const filtered = query.trim()
    ? rows.filter(r => {
        const q = query.toLowerCase();
        return r.userUsername.toLowerCase().includes(q)
          || (r.userGlobalName?.toLowerCase().includes(q) ?? false);
      })
    : rows;

  return (
    <div className="flex h-full flex-col bg-zinc-900">
      <div className="flex items-center gap-2 border-b border-zinc-800 p-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Find a DM"
          className="flex-1 rounded bg-zinc-800 px-2 py-1 text-sm text-white placeholder-zinc-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShowNewDM(true)}
          className="rounded bg-zinc-700 px-2 py-1 text-sm text-white hover:bg-zinc-600"
          aria-label="New DM"
        >
          +
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {filtered.length === 0 && (
          <div className="p-4 text-center text-sm text-zinc-500">No conversations yet.</div>
        )}
        {filtered.map(row => {
          const isActive = row.channelId === activeChannelId;
          return (
            <DMListItem
              key={row.channelId}
              row={row}
              active={isActive}
              unread={unreads.dmUnreadChannelIds.has(row.channelId)}
              mentionCount={isActive ? 0 : (unreads.mentionChannelCounts.get(row.channelId) ?? 0)}
              onClick={() => onSelect(row.channelId)}
            />
          );
        })}
      </div>
      {showNewDM && (
        <NewDMModal
          onClose={() => setShowNewDM(false)}
          onOpened={(row) => { setShowNewDM(false); setRows(prev => [row, ...prev.filter(r => r.channelId !== row.channelId)]); onSelect(row.channelId); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS — note `<NewDMModal>` not yet implemented; provide a stub or do this task and Task 16 in one commit.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/DMList.tsx src/renderer/components/DMListItem.tsx
git commit -m "feat(dms): add DMList + DMListItem"
```

---

## Task 16: `<NewDMModal>`

**Files:**
- Create: `src/renderer/components/NewDMModal.tsx`

- [ ] **Step 1: Read existing member-search code**

Look at `src/renderer/components/MembersDirectory.tsx` and `src/renderer/components/members/*` to find the member-search hook or component. The modal will reuse it (or a small copy) to search across guilds.

- [ ] **Step 2: Implement modal**

```tsx
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { DMChannelRow, MemberSummary, GuildSummary } from '@/shared/domain';

export function NewDMModal({
  onClose, onOpened,
}: {
  onClose: () => void;
  onOpened: (row: DMChannelRow) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<MemberSummary & { guildName: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    let cancelled = false;
    (async () => {
      const guildsRes = await api.guilds.list();
      if (!guildsRes.ok || cancelled) return;
      const guilds: GuildSummary[] = guildsRes.data;
      const all: Array<MemberSummary & { guildName: string }> = [];
      const seen = new Set<string>();
      await Promise.all(guilds.map(async g => {
        const res = await api.guilds.searchMembers(g.id, q, { limit: 10 });
        if (!res.ok) return;
        for (const m of res.data) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          all.push({ ...m, guildName: g.name });
        }
      }));
      if (!cancelled) setResults(all.slice(0, 25));
    })();
    return () => { cancelled = true; };
  }, [query]);

  const open = async (userId: string) => {
    setBusy(true); setError(null);
    const res = await api.dms.openWithUser(userId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.code === 'MISSING_PERMISSIONS'
        ? 'This user has DMs disabled or shares no servers with the bot.'
        : res.error.message);
      return;
    }
    onOpened(res.data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[420px] rounded-lg bg-zinc-900 p-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="mb-2 text-lg font-semibold text-white">New direct message</h2>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search members across servers"
          className="w-full rounded bg-zinc-800 px-2 py-1.5 text-sm text-white placeholder-zinc-500 focus:outline-none"
        />
        {error && <div className="mt-2 rounded bg-red-900/40 px-2 py-1 text-sm text-red-200">{error}</div>}
        <div className="mt-2 max-h-72 overflow-y-auto">
          {results.map(r => (
            <button
              key={r.id}
              type="button"
              disabled={busy}
              onClick={() => open(r.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-zinc-800 disabled:opacity-50"
            >
              <img src={r.avatarUrl ?? ''} alt="" className="h-7 w-7 rounded-full bg-zinc-700" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white">{r.displayName ?? r.username}</div>
                <div className="truncate text-xs text-zinc-500">{r.username} · {r.guildName}</div>
              </div>
            </button>
          ))}
          {query.trim().length >= 2 && results.length === 0 && (
            <div className="p-3 text-center text-sm text-zinc-500">No matches</div>
          )}
        </div>
      </div>
    </div>
  );
}
```

(Verify `MemberSummary` field names — adjust `displayName`/`username`/`avatarUrl` to match the actual type in `domain.ts`.)

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/NewDMModal.tsx
git commit -m "feat(dms): add NewDMModal member picker"
```

---

## Task 17: Composer DM mode

**Files:**
- Modify: `src/renderer/components/Composer.tsx`

- [ ] **Step 1: Add `mode` prop**

Read `Composer.tsx`. Add an optional prop `mode?: 'guild' | 'dm'` (default `'guild'`). When `mode === 'dm'`:
- Skip channel-mention autocomplete (`#`).
- Skip role-mention autocomplete.
- When the user submits, call `api.dms.send` instead of `api.messages.send`. For attachments, call `api.dms.sendWithAttachments` instead of `api.messages.sendWithAttachments`.

The simplest implementation: a single `sendImpl` selected at the top of the component:

```ts
const sendImpl = mode === 'dm'
  ? { send: api.dms.send, sendWithAttachments: api.dms.sendWithAttachments }
  : { send: api.messages.send, sendWithAttachments: api.messages.sendWithAttachments };
```

Replace existing `api.messages.send`/`api.messages.sendWithAttachments` call sites with `sendImpl.send`/`sendImpl.sendWithAttachments`.

For autocomplete: in the existing autocomplete trigger block, gate `#` and `@&` on `mode !== 'dm'`.

If send returns `MISSING_PERMISSIONS`, show an inline disabled-composer banner with the error message. (Mirror the existing error-toast path; just keep the message in component state and conditionally disable input.)

- [ ] **Step 2: Pass `mode="dm"` from `ShellRoute` when in home view**

In `ShellRoute.tsx` Home branch, render `<Composer channelId={activeDMChannelId} mode="dm" />`.

- [ ] **Step 3: Type-check + run all tests**

Run: `npx tsc -p tsconfig.json --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/Composer.tsx src/renderer/routes/shell/ShellRoute.tsx
git commit -m "feat(composer): add DM mode"
```

---

## Task 18: DM conversation header

**Files:**
- Modify: `src/renderer/routes/shell/ShellRoute.tsx`

- [ ] **Step 1: Render header above MessageList in Home view**

In the Home branch right pane, look up the `DMChannelRow` for `activeDMChannelId` (cache from `api.dms.list` or query as needed) and render:

```tsx
function DMHeader({ row, onViewProfile }: { row: DMChannelRow; onViewProfile: () => void }) {
  const displayName = row.userGlobalName ?? row.userUsername;
  return (
    <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
      <img src={row.userAvatar ?? ''} alt="" className="h-7 w-7 rounded-full bg-zinc-700" />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white">{displayName}</div>
        <div className="truncate text-xs text-zinc-500">{row.userUsername}</div>
      </div>
      <button
        type="button"
        onClick={onViewProfile}
        className="ml-auto rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
      >
        View profile
      </button>
    </div>
  );
}
```

Wire `onViewProfile` to open `<UserProfileCard>` for `row.userId` (mirror however the existing profile card is shown elsewhere — search for `UserProfileCard` usage).

Replace the guild channel header in the right pane with this component when `view === 'home'`.

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/routes/shell/ShellRoute.tsx
git commit -m "feat(dms): add conversation header with view profile"
```

---

## Task 19: OS notifications for DMs + `notifyOnDM` toggle

**Files:**
- Modify: `src/renderer/components/settings/sections/NotificationsSection.tsx`
- Modify: `src/renderer/components/settings/types.ts`
- Modify: `src/renderer/lib/use-unreads.ts` (or create `src/renderer/lib/use-dm-notifications.ts`)

- [ ] **Step 1: Add `notifyOnDM` to settings**

Read `NotificationsSection.tsx` and `settings/types.ts`. Add a boolean toggle `notifyOnDM` (default `true`). Persist via the existing settings flow (likely `api.prefs.set('notifyOnDM', ...)` or whatever pattern the section already uses). Mirror an existing toggle exactly.

- [ ] **Step 2: Create `useDMNotifications` hook**

Create `src/renderer/lib/use-dm-notifications.ts`:

```ts
import { useEffect, useRef } from 'react';
import { api } from './api';

export function useDMNotifications({
  enabled,
  isWindowFocused,
  isHomeViewActive,
  activeDMChannelId,
  onClickGotoDM,
}: {
  enabled: boolean;
  isWindowFocused: boolean;
  isHomeViewActive: boolean;
  activeDMChannelId: string | null;
  onClickGotoDM: (channelId: string) => void;
}) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const focusedRef = useRef(isWindowFocused);
  focusedRef.current = isWindowFocused;
  const homeRef = useRef(isHomeViewActive);
  homeRef.current = isHomeViewActive;
  const activeRef = useRef(activeDMChannelId);
  activeRef.current = activeDMChannelId;

  useEffect(() => {
    return api.events.onMessageCreate(({ channelId, message }) => {
      if (!enabledRef.current) return;
      if (message.guildId) return; // DMs only
      // Suppress when the user is actively viewing this DM
      if (focusedRef.current && homeRef.current && activeRef.current === channelId) return;
      const title = message.authorDisplayName ?? message.authorTag;
      const body = message.content?.trim()
        ? message.content.slice(0, 200)
        : (message.hasAttachments ? '[attachment]' : message.hasEmbeds ? '[embed]' : '');
      try {
        const n = new Notification(title, { body, icon: message.authorAvatarUrl ?? undefined });
        n.onclick = () => { onClickGotoDM(channelId); };
      } catch { /* notifications unavailable */ }
    });
  }, [onClickGotoDM]);
}
```

- [ ] **Step 3: Wire from ShellRoute**

In `ShellRoute.tsx`, read the `notifyOnDM` pref and a window-focused signal (search for `document.hasFocus` or an existing `useWindowFocus` hook; if none, add a small `useEffect` listening to `focus`/`blur`). Then:

```ts
useDMNotifications({
  enabled: notifyOnDM,
  isWindowFocused,
  isHomeViewActive: view === 'home',
  activeDMChannelId,
  onClickGotoDM: (id) => { window.focus(); setView('home'); setActiveDMChannelId(id); },
});
```

- [ ] **Step 4: Type-check + tests**

Run: `npx tsc -p tsconfig.json --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/use-dm-notifications.ts src/renderer/components/settings/sections/NotificationsSection.tsx src/renderer/components/settings/types.ts src/renderer/routes/shell/ShellRoute.tsx
git commit -m "feat(notifications): OS notification on DM with mute/focus suppression"
```

---

## Task 20: Onboarding intent copy update

**Files:**
- Modify: `src/renderer/routes/onboarding/steps/Step3Intents.tsx`

- [ ] **Step 1: Add Direct Messages line**

Read the file and find where existing intents (Server Members, Message Content, Presence) are documented. Add a parallel line for Direct Messages — non-privileged, no portal toggle needed, but explain it powers the DMs feature. Match the existing tone and structure.

Example addition (adapt to the existing UI shape):

```tsx
<li>
  <strong>Direct Messages</strong> — required for the DMs view. Lets your bot send and receive direct messages with users it shares servers with.
</li>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/routes/onboarding/steps/Step3Intents.tsx
git commit -m "docs(onboarding): mention DirectMessages intent"
```

---

## Task 21: Component test — `<DMList>` renders + ordering

**Files:**
- Create: `src/renderer/components/__tests__/DMList.test.tsx`

- [ ] **Step 1: Look at an existing component test**

Read one of the files in `src/renderer/components/__tests__/` to see the test setup (testing-library, mock api shape). Mirror it.

- [ ] **Step 2: Write tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DMList } from '../DMList';

vi.mock('@/lib/api', () => ({
  api: {
    dms: { list: vi.fn(async () => ({ ok: true, data: [
      { channelId: 'a', userId: 'ua', userUsername: 'alice', userGlobalName: 'Alice', userAvatar: null, lastMessageId: 'm', lastMessagePreview: 'hi', inert: false, createdAt: 1, updatedAt: 2 },
      { channelId: 'b', userId: 'ub', userUsername: 'bob', userGlobalName: null, userAvatar: null, lastMessageId: null, lastMessagePreview: null, inert: false, createdAt: 1, updatedAt: 1 },
    ] })) },
    events: { onMessageCreate: vi.fn(() => () => {}) },
    prefs: { get: vi.fn(async () => ({ ok: true, data: null })), set: vi.fn(async () => ({ ok: true })) },
    guilds: { list: vi.fn(async () => ({ ok: true, data: [] })) },
  },
}));

vi.mock('@/lib/use-bot-identity', () => ({ useBotIdentity: () => ({ id: 'bot' }) }));

describe('<DMList>', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders DMs ordered by updatedAt DESC and supports filtering', async () => {
    const onSelect = vi.fn();
    render(<DMList activeChannelId={null} onSelect={onSelect} />);
    // Wait microtask for the list to load.
    await screen.findByText('Alice');
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('bob')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Find a DM'), { target: { value: 'al' } });
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.queryByText('bob')).toBeNull();
  });

  it('selects a DM on click', async () => {
    const onSelect = vi.fn();
    render(<DMList activeChannelId={null} onSelect={onSelect} />);
    await screen.findByText('Alice');
    fireEvent.click(screen.getByText('Alice'));
    expect(onSelect).toHaveBeenCalledWith('a');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/renderer/components/__tests__/DMList.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/__tests__/DMList.test.tsx
git commit -m "test(dms): DMList rendering + filtering"
```

---

## Task 22: Component test — `<NewDMModal>` member search + open flow

**Files:**
- Create: `src/renderer/components/__tests__/NewDMModal.test.tsx`

- [ ] **Step 1: Write tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewDMModal } from '../NewDMModal';

vi.mock('@/lib/api', () => ({
  api: {
    guilds: {
      list: vi.fn(async () => ({ ok: true, data: [{ id: 'g1', name: 'My Guild', iconUrl: null, memberCount: 10 }] })),
      searchMembers: vi.fn(async () => ({ ok: true, data: [
        { id: 'u1', username: 'alice', displayName: 'Alice', avatarUrl: null },
      ] })),
    },
    dms: {
      openWithUser: vi.fn(async (uid: string) => ({
        ok: true,
        data: { channelId: 'c1', userId: uid, userUsername: 'alice', userGlobalName: null, userAvatar: null, lastMessageId: null, lastMessagePreview: null, inert: false, createdAt: 1, updatedAt: 1 },
      })),
    },
  },
}));

describe('<NewDMModal>', () => {
  beforeEach(() => vi.clearAllMocks());

  it('searches members on input and opens DM on click', async () => {
    const onClose = vi.fn();
    const onOpened = vi.fn();
    render(<NewDMModal onClose={onClose} onOpened={onOpened} />);
    fireEvent.change(screen.getByPlaceholderText('Search members across servers'), { target: { value: 'al' } });
    await waitFor(() => screen.getByText('Alice'));
    fireEvent.click(screen.getByText('Alice'));
    await waitFor(() => expect(onOpened).toHaveBeenCalled());
    expect(onOpened.mock.calls[0]![0].channelId).toBe('c1');
  });

  it('shows DMs-disabled error', async () => {
    const { api } = await import('@/lib/api');
    (api.dms.openWithUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false, error: { code: 'MISSING_PERMISSIONS', message: 'nope' },
    });
    render(<NewDMModal onClose={() => {}} onOpened={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Search members across servers'), { target: { value: 'al' } });
    await waitFor(() => screen.getByText('Alice'));
    fireEvent.click(screen.getByText('Alice'));
    await waitFor(() => screen.getByText(/DMs disabled/i));
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/renderer/components/__tests__/NewDMModal.test.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/__tests__/NewDMModal.test.tsx
git commit -m "test(dms): NewDMModal search + open + error"
```

---

## Task 23: Full check — type, tests, build

- [ ] **Step 1: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: Build the app**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke**

Start the dev app and verify:
- Home button appears at top of server rail with the white botcord glyph.
- Clicking Home shows the DM list pane (empty initially).
- "+ New DM" opens member picker; searching across guilds returns results; opening a user creates a DM and selects it.
- Sending a DM works; the message appears in the conversation.
- A user replying causes:
  - DM bumps to top of list with mention badge.
  - Home button shows red mention count.
  - OS notification fires (unless the DM is the active view).
- Restart the app while a DM was sent to the bot in a known channel → on reconnect, the new message appears in the list and triggers a notification.
- Settings → Notifications → toggle "Notify on DM" off → no notification on next DM.

If anything fails, file an issue and fix before declaring done.

- [ ] **Step 5: Commit any final tweaks**

```bash
git add -p
git commit -m "chore(dms): smoke-test fixes"
```

---

## Self-review notes

- Spec sections covered: architecture (Tasks 7, 9–10, 14), data model (Tasks 1–4), main process intents/listener/IPC (Tasks 5–11), renderer rail/shell/list/modal/composer/header (Tasks 13–18), unreads + notifications (Tasks 12, 19), onboarding copy (Task 20), edge cases (Task 9 `MISSING_PERMISSIONS`, Task 7 inert-on-Unknown-Channel, Task 14 stub for empty active channel), testing (Tasks 3, 6, 21, 22, 23).
- Methods are consistent: `repo.upsert`, `repo.list`, `repo.get`, `repo.markInert`, `repo.markRead` used identically across all tasks.
- IPC names consistent: `dms.list`, `dms.fetchMessages`, `dms.openWithUser`, `dms.send`, `dms.sendWithAttachments`, `dms.markRead`, `dms.close` referenced identically in contract, handlers, preload, and renderer.
- `attachDMListener` exported signature `(client, repo) => { runBackfill }` consistent across Tasks 6, 7, 10.
- `mode: 'guild' | 'dm'` on Composer used consistently in Tasks 14 and 17.
