# Members Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Members" pseudo-channel above the channel list that opens a virtualized, searchable, sortable, role-filterable directory of all guild members with multi-select bulk actions (role add/remove, kick, ban).

**Architecture:** A new view discriminator in `ShellRoute` swaps in `<MembersDirectory>` when the user picks the Members entry in `ChannelList`. The directory fetches all guild members via a new IPC handler, caches them in a ref, and derives the visible rows via `useMemo`. Bulk actions iterate per-member through new IPC handlers that reuse existing permission/hierarchy guards, with `bulkBanMembers` chunking through Discord's bulk-ban endpoint.

**Tech Stack:** Electron + React + TypeScript, discord.js 14, vitest, **new dep: `react-window`** for row virtualization.

**Spec:** `docs/superpowers/specs/2026-04-29-members-directory-design.md`

---

## File Structure

**New files:**
- `src/renderer/components/MembersDirectory.tsx` — top-level component (data fetch, layout, intent banner, selection state)
- `src/renderer/components/members/MembersToolbar.tsx` — search input, role filter, member count
- `src/renderer/components/members/MembersTable.tsx` — header row + virtualized body; selection, sort, ⋯ menu wiring
- `src/renderer/components/members/MembersBulkBar.tsx` — sticky bottom action bar
- `src/renderer/components/members/BulkRoleDialog.tsx` — role-pick + add/remove submit + progress
- `src/renderer/components/members/BulkKickDialog.tsx` — reason + progress
- `src/renderer/components/members/BulkBanDialog.tsx` — reason + delete-history + progress
- `src/main/ipc/members-bulk.ts` — the four bulk IPC handlers, registered alongside the existing modules

**Modified files:**
- `src/shared/domain.ts` — `AllMembersEntry`, `ListAllMembersResult`, `BulkActionResult` types
- `src/shared/ipc-contract.ts` — five new channel constants + `BotcordApi` entries
- `src/preload/expose.ts` — five new bindings
- `src/main/ipc/guilds.ts` — `listAllMembers` handler
- `src/main/ipc/index.ts` — register `members-bulk` module
- `src/renderer/components/ChannelList.tsx` — render Members pseudo-row above channels, add `onSelectMembers` prop
- `src/renderer/routes/shell/ShellRoute.tsx` — view discriminator, lastViewByGuild, conditional render
- `package.json` — `react-window` + `@types/react-window`

---

## Task 1: Shared types + IPC channel constants

**Files:**
- Modify: `src/shared/domain.ts` (append at end)
- Modify: `src/shared/ipc-contract.ts`

- [ ] **Step 1: Add domain types**

Append to `src/shared/domain.ts`:

```ts
export type AllMembersEntry = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  status: PresenceStatus;
  isBot: boolean;
  joinedAt: number | null;     // ms epoch — null if unknown
  createdAt: number;           // ms epoch
  roleColor: string | null;    // "#rrggbb" or null
  topRole: MemberRole | null;
  roleIds: string[];           // excluding @everyone
};

export type ListAllMembersResult = {
  entries: AllMembersEntry[];
  intentMissing: boolean;
};

export type BulkActionResult = {
  ok: string[];
  failed: Array<{ id: string; error: string }>;
};
```

- [ ] **Step 2: Add IPC channel constants**

In `src/shared/ipc-contract.ts`, inside the `IPC_CHANNELS` object (after `'guilds.timeoutMember'`), add:

```ts
  'guilds.listAllMembers': 'guilds.listAllMembers',
  'guilds.bulkAssignRole': 'guilds.bulkAssignRole',
  'guilds.bulkRemoveRole': 'guilds.bulkRemoveRole',
  'guilds.bulkKickMembers': 'guilds.bulkKickMembers',
  'guilds.bulkBanMembers': 'guilds.bulkBanMembers',
```

- [ ] **Step 3: Update BotcordApi interface**

In `src/shared/ipc-contract.ts`, add `AllMembersEntry, ListAllMembersResult, BulkActionResult` to the `./domain` import. Inside `guilds: { ... }` (after `timeoutMember`) add:

```ts
    listAllMembers(guildId: string): Promise<Result<ListAllMembersResult>>;
    bulkAssignRole(guildId: string, userIds: string[], roleId: string): Promise<Result<BulkActionResult>>;
    bulkRemoveRole(guildId: string, userIds: string[], roleId: string): Promise<Result<BulkActionResult>>;
    bulkKickMembers(guildId: string, userIds: string[], reason?: string): Promise<Result<BulkActionResult>>;
    bulkBanMembers(guildId: string, userIds: string[], opts: { reason?: string; deleteMessageSeconds?: number }): Promise<Result<BulkActionResult>>;
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: PASS for `src/shared/**`. The preload file will error about missing methods until Task 6 — that is expected and noted in the report. Other errors should be fixed.

- [ ] **Step 5: Commit**

```bash
git add src/shared/domain.ts src/shared/ipc-contract.ts
git commit -m "feat(ipc): add members-directory IPC contract types"
```

---

## Task 2: Add react-window dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dep**

Run: `npm install react-window @types/react-window --save`

(Adds `react-window` to `dependencies` and `@types/react-window` to `devDependencies`.)

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS. Preload error from Task 1 is still expected.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add react-window for virtualized members table"
```

---

## Task 3: `listAllMembers` IPC handler

**Files:**
- Modify: `src/main/ipc/guilds.ts` (append handler)

- [ ] **Step 1: Add handler at end of `registerGuildHandlers`**

Add `AllMembersEntry, ListAllMembersResult` to the existing `../../shared/domain` import.

Add the handler before the closing `}` of `registerGuildHandlers`:

```ts
  ipcMain.handle(IPC_CHANNELS['guilds.listAllMembers'], async (_, guildId: unknown): Promise<Result<ListAllMembersResult>> => {
    if (typeof guildId !== 'string') return err('INTERNAL', 'guildId must be a string');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);

    let intentMissing = false;
    try {
      await guild.members.fetch();
    } catch {
      // Privileged Members Intent not granted — proceed with whatever's cached.
      intentMissing = true;
    }

    const entries: AllMembersEntry[] = Array.from(guild.members.cache.values()).map(m => {
      const status = (m.presence?.status ?? 'offline') as PresenceStatus;
      const hoist = m.roles.hoist;
      const roleIds = m.roles.cache
        .filter(r => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => r.id);
      return {
        id: m.id,
        displayName: m.displayName,
        username: m.user.username,
        avatarUrl: m.user.displayAvatarURL({ size: 64 }),
        status,
        isBot: m.user.bot,
        joinedAt: m.joinedTimestamp ?? null,
        createdAt: m.user.createdTimestamp,
        roleColor: m.displayHexColor && m.displayHexColor !== '#000000' ? m.displayHexColor : null,
        topRole: hoist
          ? {
              id: hoist.id,
              name: hoist.name,
              color: hoist.color ? `#${hoist.color.toString(16).padStart(6, '0')}` : null,
              position: hoist.position,
              iconUrl: hoist.iconURL({ size: 32 }),
              unicodeEmoji: hoist.unicodeEmoji ?? null,
            }
          : null,
        roleIds,
      };
    });
    return ok({ entries, intentMissing });
  });
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS for `src/main/**`. Preload error still expected.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/guilds.ts
git commit -m "feat(ipc): add listAllMembers handler with intent fallback"
```

---

## Task 4: Bulk role IPC handlers

**Files:**
- Create: `src/main/ipc/members-bulk.ts`
- Modify: `src/main/ipc/index.ts` (register the new module)

- [ ] **Step 1: Create the new IPC module with bulk role handlers**

Create `src/main/ipc/members-bulk.ts`:

```ts
import { ipcMain } from 'electron';
import { PermissionsBitField, type GuildMember } from 'discord.js';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { BulkActionResult } from '../../shared/domain';
import type { IpcDeps } from './index';

// Resolve the guild + bot member, validating that the bot has the given
// permission flag. Returns either a context object or a Result error.
async function resolveBotContext(
  manager: IpcDeps['manager'],
  guildId: string,
  requiredFlag: bigint,
  permName: string,
): Promise<{ guild: import('discord.js').Guild; botMember: GuildMember } | Result<never>> {
  const client = manager.getClient();
  if (!client || !client.isReady() || !client.user) return err('GATEWAY_OFFLINE', 'Bot is not connected');
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);
  const botMember = guild.members.cache.get(client.user.id) ?? await guild.members.fetch(client.user.id).catch(() => null);
  if (!botMember) return err('NOT_FOUND', 'Bot member not found in guild');
  if (!botMember.permissions.has(requiredFlag)) {
    return err('FORBIDDEN', `Bot is missing the ${permName} permission`);
  }
  return { guild, botMember };
}

async function fetchTarget(guild: import('discord.js').Guild, userId: string): Promise<GuildMember | null> {
  const cached = guild.members.cache.get(userId);
  if (cached) return cached;
  try { return await guild.members.fetch(userId); } catch { return null; }
}

export function registerMembersBulkHandlers({ manager }: IpcDeps): void {
  ipcMain.handle(IPC_CHANNELS['guilds.bulkAssignRole'], async (_, guildId: unknown, userIds: unknown, roleId: unknown): Promise<Result<BulkActionResult>> => {
    if (typeof guildId !== 'string' || !Array.isArray(userIds) || typeof roleId !== 'string') {
      return err('INTERNAL', 'guildId, userIds[], roleId required');
    }
    const ctx = await resolveBotContext(manager, guildId, PermissionsBitField.Flags.ManageRoles, 'Manage Roles');
    if ('ok' in ctx) return ctx;
    const role = ctx.guild.roles.cache.get(roleId);
    if (!role) return err('NOT_FOUND', `Role ${roleId} not found`);
    if (role.managed) return err('FORBIDDEN', 'Cannot assign integration-managed roles');
    if (role.position >= ctx.botMember.roles.highest.position) {
      return err('FORBIDDEN', "Role is at or above the bot's highest role");
    }

    const result: BulkActionResult = { ok: [], failed: [] };
    for (const id of userIds) {
      if (typeof id !== 'string') { result.failed.push({ id: String(id), error: 'invalid id' }); continue; }
      const target = await fetchTarget(ctx.guild, id);
      if (!target) { result.failed.push({ id, error: 'member not found' }); continue; }
      if (target.roles.highest.position >= ctx.botMember.roles.highest.position) {
        result.failed.push({ id, error: "target's highest role is at or above the bot's" });
        continue;
      }
      try {
        await target.roles.add(role, 'Bulk-assigned via BotCord');
        result.ok.push(id);
      } catch (e) {
        result.failed.push({ id, error: e instanceof Error ? e.message : 'unknown error' });
      }
    }
    return ok(result);
  });

  ipcMain.handle(IPC_CHANNELS['guilds.bulkRemoveRole'], async (_, guildId: unknown, userIds: unknown, roleId: unknown): Promise<Result<BulkActionResult>> => {
    if (typeof guildId !== 'string' || !Array.isArray(userIds) || typeof roleId !== 'string') {
      return err('INTERNAL', 'guildId, userIds[], roleId required');
    }
    const ctx = await resolveBotContext(manager, guildId, PermissionsBitField.Flags.ManageRoles, 'Manage Roles');
    if ('ok' in ctx) return ctx;
    const role = ctx.guild.roles.cache.get(roleId);
    if (!role) return err('NOT_FOUND', `Role ${roleId} not found`);
    if (role.managed) return err('FORBIDDEN', 'Cannot remove integration-managed roles');
    if (role.position >= ctx.botMember.roles.highest.position) {
      return err('FORBIDDEN', "Role is at or above the bot's highest role");
    }

    const result: BulkActionResult = { ok: [], failed: [] };
    for (const id of userIds) {
      if (typeof id !== 'string') { result.failed.push({ id: String(id), error: 'invalid id' }); continue; }
      const target = await fetchTarget(ctx.guild, id);
      if (!target) { result.failed.push({ id, error: 'member not found' }); continue; }
      if (target.roles.highest.position >= ctx.botMember.roles.highest.position) {
        result.failed.push({ id, error: "target's highest role is at or above the bot's" });
        continue;
      }
      try {
        await target.roles.remove(role, 'Bulk-removed via BotCord');
        result.ok.push(id);
      } catch (e) {
        result.failed.push({ id, error: e instanceof Error ? e.message : 'unknown error' });
      }
    }
    return ok(result);
  });
}
```

- [ ] **Step 2: Register the new module**

Modify `src/main/ipc/index.ts`:

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
import type { ClientManager } from '../discord/client-manager';

export type IpcDeps = {
  vault: TokenVault;
  manager: ClientManager;
  db: DB;
};

export function registerAllIpc(deps: IpcDeps): void {
  registerBotHandlers(deps);
  registerGuildHandlers(deps);
  registerMessageHandlers(deps);
  registerSystemHandlers();
  registerDraftsHandlers(deps);
  registerPrefsHandlers(deps);
  registerMembersBulkHandlers(deps);
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS for `src/main/**`. Preload error still expected.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/members-bulk.ts src/main/ipc/index.ts
git commit -m "feat(ipc): add bulk role assign/remove handlers"
```

---

## Task 5: Bulk kick + ban IPC handlers

**Files:**
- Modify: `src/main/ipc/members-bulk.ts`

- [ ] **Step 1: Append the kick handler**

Inside `registerMembersBulkHandlers`, add:

```ts
  ipcMain.handle(IPC_CHANNELS['guilds.bulkKickMembers'], async (_, guildId: unknown, userIds: unknown, reason: unknown): Promise<Result<BulkActionResult>> => {
    if (typeof guildId !== 'string' || !Array.isArray(userIds)) {
      return err('INTERNAL', 'guildId and userIds[] required');
    }
    const r = typeof reason === 'string' && reason.length > 0 ? reason.slice(0, 512) : undefined;
    const ctx = await resolveBotContext(manager, guildId, PermissionsBitField.Flags.KickMembers, 'Kick Members');
    if ('ok' in ctx) return ctx;

    const result: BulkActionResult = { ok: [], failed: [] };
    for (const id of userIds) {
      if (typeof id !== 'string') { result.failed.push({ id: String(id), error: 'invalid id' }); continue; }
      const target = await fetchTarget(ctx.guild, id);
      if (!target) { result.failed.push({ id, error: 'member not found' }); continue; }
      if (target.id === ctx.botMember.id) { result.failed.push({ id, error: 'cannot kick the bot itself' }); continue; }
      if (target.roles.highest.position >= ctx.botMember.roles.highest.position) {
        result.failed.push({ id, error: "target's highest role is at or above the bot's" });
        continue;
      }
      try {
        await target.kick(r);
        result.ok.push(id);
      } catch (e) {
        result.failed.push({ id, error: e instanceof Error ? e.message : 'unknown error' });
      }
    }
    return ok(result);
  });
```

- [ ] **Step 2: Append the ban handler with bulk-create chunking**

```ts
  ipcMain.handle(IPC_CHANNELS['guilds.bulkBanMembers'], async (_, guildId: unknown, userIds: unknown, opts: unknown): Promise<Result<BulkActionResult>> => {
    if (typeof guildId !== 'string' || !Array.isArray(userIds)) {
      return err('INTERNAL', 'guildId and userIds[] required');
    }
    const o = (opts && typeof opts === 'object' ? opts : {}) as { reason?: string; deleteMessageSeconds?: number };
    const reason = typeof o.reason === 'string' && o.reason.length > 0 ? o.reason.slice(0, 512) : undefined;
    const dms = typeof o.deleteMessageSeconds === 'number' && o.deleteMessageSeconds >= 0 && o.deleteMessageSeconds <= 604800
      ? Math.floor(o.deleteMessageSeconds)
      : 0;

    const ctx = await resolveBotContext(manager, guildId, PermissionsBitField.Flags.BanMembers, 'Ban Members');
    if ('ok' in ctx) return ctx;

    // Filter out invalid IDs, the bot itself, and out-of-hierarchy targets up
    // front so the bulk endpoint only sees ids it can act on.
    const result: BulkActionResult = { ok: [], failed: [] };
    const eligible: string[] = [];
    for (const id of userIds) {
      if (typeof id !== 'string') { result.failed.push({ id: String(id), error: 'invalid id' }); continue; }
      const target = await fetchTarget(ctx.guild, id);
      if (!target) { result.failed.push({ id, error: 'member not found' }); continue; }
      if (target.id === ctx.botMember.id) { result.failed.push({ id, error: 'cannot ban the bot itself' }); continue; }
      if (target.roles.highest.position >= ctx.botMember.roles.highest.position) {
        result.failed.push({ id, error: "target's highest role is at or above the bot's" });
        continue;
      }
      eligible.push(id);
    }

    // Discord's bulk-ban endpoint accepts up to 200 user IDs per call.
    const chunkSize = 200;
    for (let i = 0; i < eligible.length; i += chunkSize) {
      const chunk = eligible.slice(i, i + chunkSize);
      try {
        const banResp = await ctx.guild.bans.bulkCreate(chunk, {
          ...(reason ? { reason } : {}),
          deleteMessageSeconds: dms,
        });
        // bulkCreate returns { bannedUsers: Snowflake[]; failedUsers: Snowflake[] }
        for (const ok_id of banResp.bannedUsers ?? []) result.ok.push(ok_id);
        for (const failed_id of banResp.failedUsers ?? []) result.failed.push({ id: failed_id, error: 'failed via bulk endpoint' });
      } catch {
        // Fall back to per-member ban for this chunk.
        for (const id of chunk) {
          try {
            const member = ctx.guild.members.cache.get(id);
            if (member) await member.ban({ ...(reason ? { reason } : {}), deleteMessageSeconds: dms });
            else await ctx.guild.bans.create(id, { ...(reason ? { reason } : {}), deleteMessageSeconds: dms });
            result.ok.push(id);
          } catch (e) {
            result.failed.push({ id, error: e instanceof Error ? e.message : 'unknown error' });
          }
        }
      }
    }

    return ok(result);
  });
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS for `src/main/**`.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/members-bulk.ts
git commit -m "feat(ipc): add bulk kick + bulk ban handlers"
```

---

## Task 6: Preload bindings

**Files:**
- Modify: `src/preload/expose.ts`

- [ ] **Step 1: Add bindings**

Inside the `guilds:` block (after `timeoutMember`), add:

```ts
    listAllMembers: (guildId) => invoke(IPC_CHANNELS['guilds.listAllMembers'], guildId),
    bulkAssignRole: (guildId, userIds, roleId) => invoke(IPC_CHANNELS['guilds.bulkAssignRole'], guildId, userIds, roleId),
    bulkRemoveRole: (guildId, userIds, roleId) => invoke(IPC_CHANNELS['guilds.bulkRemoveRole'], guildId, userIds, roleId),
    bulkKickMembers: (guildId, userIds, reason) => invoke(IPC_CHANNELS['guilds.bulkKickMembers'], guildId, userIds, reason),
    bulkBanMembers: (guildId, userIds, opts) => invoke(IPC_CHANNELS['guilds.bulkBanMembers'], guildId, userIds, opts),
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS clean (no preload error remaining).

- [ ] **Step 3: Commit**

```bash
git add src/preload/expose.ts
git commit -m "feat(preload): expose members-directory IPC handlers"
```

---

## Task 7: ChannelList Members entry + ShellRoute view discriminator

**Files:**
- Modify: `src/renderer/components/ChannelList.tsx`
- Modify: `src/renderer/routes/shell/ShellRoute.tsx`

- [ ] **Step 1: Add a `view` prop and Members row to ChannelList**

In `src/renderer/components/ChannelList.tsx`, replace the prop type and the body of the component to add a Members row above the channels. Replace the existing `export function ChannelList(...)` signature and the JSX immediately above the `return` block (the `if (!guildId) return ...` and the renderer's main `return`):

```tsx
import { IconUsers } from '@tabler/icons-react';
```

Add `IconUsers` to the existing `@tabler/icons-react` import line.

Replace the function signature:

```tsx
export function ChannelList({
  guildId, selected, onSelect, unreadIds, view, onSelectMembers, memberCount,
}: {
  guildId: string | null;
  selected: string | null;
  onSelect: (id: string) => void;
  unreadIds?: Set<string>;
  view: 'channel' | 'members';
  onSelectMembers: () => void;
  memberCount: number | null;
}) {
```

Then, inside the existing main `return` of `ChannelList`, replace the opening of the return block to add the Members row at the top of the scrollable area. Replace this:

```tsx
  return (
    <div className="h-full overflow-y-auto px-2 pt-2 pb-4">
      {uncategorized
        .filter(c => c.type !== 'thread')
        .map(renderChannelWithThreads)}
```

with this:

```tsx
  const membersSelected = view === 'members';
  return (
    <div className="h-full overflow-y-auto px-2 pt-2 pb-4">
      <button
        onClick={onSelectMembers}
        className={`w-full flex items-center gap-1.5 px-2 py-[5px] rounded text-left text-[15px] leading-5 transition-colors duration-150 mb-1
          ${membersSelected
            ? 'bg-selected text-fg'
            : 'text-fg-dim hover:bg-hover hover:text-fg-muted'}`}
      >
        <IconUsers size={20} stroke={1.75} className={membersSelected ? 'text-fg shrink-0' : 'text-fg-dim shrink-0'} />
        <span className="truncate flex-1">Members</span>
        {memberCount != null && (
          <span className="text-[12px] text-fg-dim">{memberCount}</span>
        )}
      </button>
      {uncategorized
        .filter(c => c.type !== 'thread')
        .map(renderChannelWithThreads)}
```

- [ ] **Step 2: Add view discriminator to ShellRoute**

Modify `src/renderer/routes/shell/ShellRoute.tsx` to introduce the view state. Replace the entire file's contents with:

```tsx
import { useEffect, useRef, useState } from 'react';
import { ServerRail } from '../../components/ServerRail';
import { ChannelList } from '../../components/ChannelList';
import { BotIdentityFooter } from '../../components/BotIdentityFooter';
import { SettingsPanel } from '../../components/SettingsPanel';
import { Toaster } from '../../components/Toaster';
import { ChannelView } from './ChannelView';
import { ForumView } from './ForumView';
import { MembersDirectory } from '../../components/MembersDirectory';
import { api } from '../../lib/api';
import { useUnreads } from '../../lib/use-unreads';
import type { ChannelSummary, GuildSummary } from '../../../shared/domain';
import { IconChevronDown } from '@tabler/icons-react';

type ForumPostRef = { postId: string; postName: string; forumId: string; forumName: string };
type View = { kind: 'channel'; channelId: string | null } | { kind: 'members' };

export function ShellRoute() {
  const [guild, setGuild] = useState<GuildSummary | null>(null);
  const [view, setView] = useState<View>({ kind: 'channel', channelId: null });
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [forumPostRef, setForumPostRef] = useState<ForumPostRef | null>(null);
  const lastViewByGuild = useRef<Map<string, View>>(new Map());

  useEffect(() => {
    if (!guild) { setChannels([]); return; }
    api.guilds.listChannels(guild.id).then(res => { if (res.ok) setChannels(res.data); });
  }, [guild]);

  const channelId = view.kind === 'channel' ? view.channelId : null;
  const selectedChannel = channels.find(c => c.id === channelId) ?? null;
  const channelName = selectedChannel?.name
    ?? (forumPostRef && forumPostRef.postId === channelId ? forumPostRef.postName : null);
  const unreads = useUnreads(channelId);

  const parentChannel = selectedChannel?.parentId
    ? channels.find(c => c.id === selectedChannel.parentId) ?? null
    : null;
  const backToForum = selectedChannel?.type === 'thread' && parentChannel?.type === 'forum'
    ? { id: parentChannel.id, name: parentChannel.name, onClick: () => { setForumPostRef(null); setView({ kind: 'channel', channelId: parentChannel.id }); } }
    : forumPostRef && forumPostRef.postId === channelId
      ? { id: forumPostRef.forumId, name: forumPostRef.forumName, onClick: () => { setForumPostRef(null); setView({ kind: 'channel', channelId: forumPostRef.forumId }); } }
      : undefined;

  const setChannelView = (id: string | null) => { setForumPostRef(null); setView({ kind: 'channel', channelId: id }); };
  const setMembersView = () => setView({ kind: 'members' });

  return (
    <div className="h-full flex bg-bg-sunken">
      <aside className="w-[64px] shrink-0 min-h-0">
        <ServerRail
          selected={guild?.id ?? null}
          onSelect={(g) => {
            if (guild) lastViewByGuild.current.set(guild.id, view);
            setGuild(g);
            const remembered = lastViewByGuild.current.get(g.id);
            setView(remembered ?? { kind: 'channel', channelId: null });
            setForumPostRef(null);
          }}
          unreadGuildIds={unreads.guildIds}
        />
      </aside>
      <aside className="w-[310px] shrink-0 min-h-0 bg-bg-sunken flex flex-col rounded-tl-xl border-t border-l border-white/[0.04] overflow-hidden">
        <div className="h-12 px-4 flex items-center justify-between border-b border-white/[0.04] shrink-0">
          <span className="font-semibold text-fg text-[15px] truncate">{guild?.name ?? 'BotCord'}</span>
          <IconChevronDown size={18} stroke={2} className="text-fg-muted shrink-0 ml-2" />
        </div>
        <div className="flex-1 min-h-0">
          <ChannelList
            guildId={guild?.id ?? null}
            selected={channelId}
            onSelect={setChannelView}
            unreadIds={unreads.channelIds}
            view={view.kind}
            onSelectMembers={setMembersView}
            memberCount={guild?.memberCount ?? null}
          />
        </div>
        <BotIdentityFooter onOpenSettings={() => setSettingsOpen(true)} />
      </aside>
      {view.kind === 'members' ? (
        <MembersDirectory guildId={guild?.id ?? null} />
      ) : selectedChannel?.type === 'forum' ? (
        <ForumView
          guildId={guild?.id ?? null}
          forumId={selectedChannel.id}
          forumName={selectedChannel.name}
          onSelectPost={(postId, postName) => {
            setForumPostRef({ postId, postName, forumId: selectedChannel.id, forumName: selectedChannel.name });
            setView({ kind: 'channel', channelId: postId });
          }}
        />
      ) : (
        <ChannelView
          channelId={channelId}
          guildId={guild?.id ?? null}
          channelName={channelName}
          {...(backToForum ? { backToForum } : {})}
        />
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      <Toaster />
    </div>
  );
}
```

- [ ] **Step 3: Stub MembersDirectory so the build passes**

Create `src/renderer/components/MembersDirectory.tsx` with a placeholder shell — full implementation comes in Task 8:

```tsx
export function MembersDirectory({ guildId }: { guildId: string | null }) {
  return (
    <main className="flex-1 min-h-0 bg-bg-sunken text-fg p-6 border-t border-l border-white/[0.04]">
      <h1 className="text-lg font-semibold">Members</h1>
      <p className="text-fg-dim text-sm mt-1">Guild: {guildId ?? '—'}</p>
    </main>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ChannelList.tsx src/renderer/routes/shell/ShellRoute.tsx src/renderer/components/MembersDirectory.tsx
git commit -m "feat(shell): add Members entry + view discriminator"
```

---

## Task 8: MembersDirectory shell — fetch + intent banner + layout scaffold

**Files:**
- Modify: `src/renderer/components/MembersDirectory.tsx`

- [ ] **Step 1: Replace the stub with the full shell**

Replace the contents of `src/renderer/components/MembersDirectory.tsx` with:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { pushToast } from './Toaster';
import type { AllMembersEntry, GuildRole } from '../../shared/domain';

export function MembersDirectory({ guildId }: { guildId: string | null }) {
  const [entries, setEntries] = useState<AllMembersEntry[]>([]);
  const [intentMissing, setIntentMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState<GuildRole[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'name' | 'joinedAt' | 'createdAt'>('joinedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const cache = useRef<Map<string, { entries: AllMembersEntry[]; intentMissing: boolean }>>(new Map());

  useEffect(() => {
    if (!guildId) { setEntries([]); setRoles([]); setSelected(new Set()); return; }
    let active = true;

    const cached = cache.current.get(guildId);
    if (cached) {
      setEntries(cached.entries);
      setIntentMissing(cached.intentMissing);
    } else {
      setLoading(true);
      setEntries([]);
      api.guilds.listAllMembers(guildId).then(res => {
        if (!active) return;
        setLoading(false);
        if (res.ok) {
          cache.current.set(guildId, res.data);
          setEntries(res.data.entries);
          setIntentMissing(res.data.intentMissing);
        } else {
          pushToast('danger', res.error.message);
        }
      });
    }

    api.guilds.listGuildRoles(guildId).then(res => {
      if (!active) return;
      if (res.ok) setRoles(res.data);
    });

    setSelected(new Set());
    setSearch('');
    setRoleFilter(null);

    return () => { active = false; };
  }, [guildId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = entries;
    if (q) {
      rows = rows.filter(e =>
        e.displayName.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q),
      );
    }
    if (roleFilter) {
      rows = rows.filter(e => e.roleIds.includes(roleFilter));
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (sortKey === 'name') return dir * a.displayName.localeCompare(b.displayName);
      if (sortKey === 'joinedAt') return dir * ((a.joinedAt ?? 0) - (b.joinedAt ?? 0));
      return dir * (a.createdAt - b.createdAt);
    });
    return rows;
  }, [entries, search, roleFilter, sortKey, sortDir]);

  if (!guildId) {
    return (
      <main className="flex-1 min-h-0 bg-bg-sunken text-fg-dim flex items-center justify-center border-t border-l border-white/[0.04]">
        Select a server to view its members.
      </main>
    );
  }

  return (
    <main className="flex-1 min-h-0 bg-bg-sunken text-fg flex flex-col border-t border-l border-white/[0.04]">
      {intentMissing && (
        <div className="px-4 py-2 bg-warn/10 border-b border-warn/30 text-warn text-[12px]">
          Bot lacks the privileged Server Members Intent — directory shows cached members only. Enable it in the Discord Developer Portal for the full list.
        </div>
      )}
      <div className="px-4 py-3 border-b border-white/[0.04] text-fg-dim text-[13px]">
        {/* Toolbar mounts here in Task 9 */}
        {loading ? 'Loading members…' : `${filtered.length} members`}
        {search || roleFilter ? ` (filtered from ${entries.length})` : ''}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Table mounts here in Task 10. Scaffold list for now: */}
        <ul className="p-4 space-y-1 text-[13px]">
          {filtered.slice(0, 50).map(e => (
            <li key={e.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.has(e.id)}
                onChange={() => setSelected(prev => {
                  const next = new Set(prev);
                  if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
                  return next;
                })}
              />
              <span style={e.roleColor ? { color: e.roleColor } : undefined}>{e.displayName}</span>
              <span className="text-fg-dim">@{e.username}</span>
            </li>
          ))}
          {filtered.length > 50 && <li className="text-fg-dim">…and {filtered.length - 50} more (table coming in Task 10)</li>}
        </ul>
      </div>
      {selected.size > 0 && (
        <div className="px-4 py-3 border-t border-white/[0.04] text-fg-dim text-[12px]">
          {selected.size} selected (bulk bar coming in Task 13)
        </div>
      )}
      {/* Suppress unused for now — used by Tasks 9+ */}
      <span className="hidden">{roles.length} roles cached</span>
      <span className="hidden">{[setRoleFilter, setSortKey, setSortDir].length}</span>
    </main>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS. The two `<span className="hidden">` markers exist purely to keep `roles`, `setRoleFilter`, `setSortKey`, `setSortDir` referenced under `noUnusedLocals`/`noUnusedParameters`. They will be removed naturally as Tasks 9-13 wire them up.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/MembersDirectory.tsx
git commit -m "feat(members): scaffold MembersDirectory with data fetch and filter state"
```

---

## Task 9: MembersToolbar — search + role filter + count

**Files:**
- Create: `src/renderer/components/members/MembersToolbar.tsx`
- Modify: `src/renderer/components/MembersDirectory.tsx`

- [ ] **Step 1: Create the toolbar component**

```tsx
// src/renderer/components/members/MembersToolbar.tsx
import type { GuildRole } from '../../../shared/domain';
import { IconSearch } from '@tabler/icons-react';

export function MembersToolbar({
  search, onSearch,
  roles, roleFilter, onRoleFilter,
  totalCount, filteredCount, intentMissing,
}: {
  search: string;
  onSearch: (q: string) => void;
  roles: GuildRole[];
  roleFilter: string | null;
  onRoleFilter: (id: string | null) => void;
  totalCount: number;
  filteredCount: number;
  intentMissing: boolean;
}) {
  const isFiltered = search.trim().length > 0 || roleFilter !== null;
  return (
    <div className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-3">
      <div className="relative flex-1 max-w-[320px]">
        <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-dim" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search members…"
          className="w-full pl-8 pr-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
        />
      </div>
      <select
        value={roleFilter ?? ''}
        onChange={(e) => onRoleFilter(e.target.value || null)}
        className="px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent min-w-[160px]"
      >
        <option value="">All roles</option>
        {roles.filter(r => !r.managed).map(r => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
      <div className="ml-auto text-fg-dim text-[12px]">
        {isFiltered ? `${filteredCount} of ${totalCount} members` : `${totalCount} members`}
        {intentMissing && <span className="ml-2 text-warn">(cached only)</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into MembersDirectory**

In `src/renderer/components/MembersDirectory.tsx`, import the toolbar and replace the placeholder count `<div>` (the `{loading ? ... : ...}` line) with `<MembersToolbar />`:

Add import:
```tsx
import { MembersToolbar } from './members/MembersToolbar';
```

Replace this block:
```tsx
      <div className="px-4 py-3 border-b border-white/[0.04] text-fg-dim text-[13px]">
        {/* Toolbar mounts here in Task 9 */}
        {loading ? 'Loading members…' : `${filtered.length} members`}
        {search || roleFilter ? ` (filtered from ${entries.length})` : ''}
      </div>
```

with:
```tsx
      <MembersToolbar
        search={search}
        onSearch={setSearch}
        roles={roles}
        roleFilter={roleFilter}
        onRoleFilter={setRoleFilter}
        totalCount={entries.length}
        filteredCount={filtered.length}
        intentMissing={intentMissing}
      />
      {loading && entries.length === 0 && (
        <div className="px-4 py-2 text-fg-dim text-[12px]">Loading members…</div>
      )}
```

Also delete the first `<span className="hidden">{roles.length} roles cached</span>` marker — it's no longer needed because `roles` is referenced via `<MembersToolbar roles={roles} />` and `setRoleFilter` is referenced via `onRoleFilter={setRoleFilter}`. Keep the second marker for `setSortKey`/`setSortDir` until Task 10.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/members/MembersToolbar.tsx src/renderer/components/MembersDirectory.tsx
git commit -m "feat(members): add toolbar with search, role filter, count"
```

---

## Task 10: MembersTable — virtualized rows, header, sort, ⋯ menu

**Files:**
- Create: `src/renderer/components/members/MembersTable.tsx`
- Modify: `src/renderer/components/MembersDirectory.tsx`

- [ ] **Step 1: Create the table component**

Create `src/renderer/components/members/MembersTable.tsx`:

```tsx
import { useState } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { Avatar } from '../Avatar';
import { openContextMenu, updateContextMenuItems } from '../ContextMenu';
import { buildUserMenu, type UserMenuTarget } from '../UserContextMenu';
import { KickDialog } from '../moderation/KickDialog';
import { BanDialog } from '../moderation/BanDialog';
import { TimeoutDialog } from '../moderation/TimeoutDialog';
import { pushToast } from '../Toaster';
import { api } from '../../lib/api';
import { IconChevronUp, IconChevronDown, IconDots } from '@tabler/icons-react';
import type { AllMembersEntry, BotCapabilities, GuildRole, MemberDetail } from '../../../shared/domain';

export type SortKey = 'name' | 'joinedAt' | 'createdAt';
export type SortDir = 'asc' | 'desc';

const ROW_HEIGHT = 44;

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const formatDate = (ms: number | null): string => ms == null ? '—' : dateFmt.format(new Date(ms));

export function MembersTable({
  guildId,
  rows,
  selected,
  onToggleSelected,
  onToggleAllFiltered,
  sortKey,
  sortDir,
  onSort,
  rolesById,
}: {
  guildId: string;
  rows: AllMembersEntry[];
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
  onToggleAllFiltered: () => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  rolesById: Map<string, GuildRole>;
}) {
  const [modState, setModState] = useState<{ kind: 'kick' | 'ban' | 'timeout'; userId: string; displayName: string } | null>(null);
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const someSelected = !allSelected && rows.some(r => selected.has(r.id));

  const headerCol = (label: string, key: SortKey | null) => {
    const active = key !== null && sortKey === key;
    const sortable = key !== null;
    return (
      <button
        type="button"
        disabled={!sortable}
        onClick={() => sortable && onSort(key)}
        className={`flex items-center gap-1 ${sortable ? 'hover:text-fg' : ''} ${active ? 'text-fg' : 'text-fg-dim'}`}
      >
        <span>{label}</span>
        {active && (sortDir === 'asc' ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />)}
      </button>
    );
  };

  const onMore = async (e: React.MouseEvent, m: AllMembersEntry) => {
    e.preventDefault();
    e.stopPropagation();
    const anchorRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clientX = anchorRect.right;
    const clientY = anchorRect.bottom;

    const [capRes, memRes] = await Promise.all([
      api.guilds.getBotCapabilities(guildId, m.id),
      api.guilds.getMember(guildId, m.id),
    ]);
    const capabilities: BotCapabilities | null = capRes.ok ? capRes.data : null;
    const detail: MemberDetail | null = memRes.ok ? memRes.data : null;
    if (!capabilities) {
      pushToast('danger', capRes.ok ? 'Failed to load capabilities' : capRes.error.message);
      return;
    }
    const target: UserMenuTarget = {
      guildId,
      userId: m.id,
      username: m.username,
      displayName: m.displayName,
      assignedRoleIds: new Set(detail?.roles.map(r => r.id) ?? []),
    };
    const buildItems = (rolesArr: GuildRole[] | null) => buildUserMenu({
      target,
      capabilities,
      roles: rolesArr,
      callbacks: {
        onOpenProfile:  () => pushToast('info', `Profile for @${m.username}`),
        onMention:      () => { void api.system.copyText(`<@${m.id}>`); pushToast('ok', 'Mention copied'); },
        onCopyUsername: () => { void api.system.copyText(m.username); pushToast('ok', 'Username copied'); },
        onCopyUserId:   () => { void api.system.copyText(m.id); pushToast('ok', 'ID copied'); },
        onOpenKick:     () => setModState({ kind: 'kick',    userId: m.id, displayName: m.displayName }),
        onOpenBan:      () => setModState({ kind: 'ban',     userId: m.id, displayName: m.displayName }),
        onOpenTimeout:  () => setModState({ kind: 'timeout', userId: m.id, displayName: m.displayName }),
        onToggleRole: async (roleId, currentlyAssigned) => {
          const res = currentlyAssigned
            ? await api.guilds.removeRole(guildId, m.id, roleId)
            : await api.guilds.assignRole(guildId, m.id, roleId);
          if (!res.ok) pushToast('danger', res.error.message);
        },
      },
    });

    const rolesNow = Array.from(rolesById.values());
    openContextMenu({ preventDefault: () => {}, clientX, clientY }, buildItems(rolesNow));
    void updateContextMenuItems; // silence unused warning until rolesById changes after open (n/a here)
  };

  const Row = ({ index, style }: ListChildComponentProps) => {
    const m = rows[index]!;
    const isChecked = selected.has(m.id);
    return (
      <div style={style} className="flex items-center px-4 gap-3 hover:bg-hover text-[13px]">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggleSelected(m.id)}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0"
        />
        <div className="flex items-center gap-2 min-w-0 w-[260px]">
          <Avatar
            src={m.avatarUrl}
            alt=""
            className="w-6 h-6 rounded-full shrink-0"
            fallback={<div className="w-6 h-6 rounded-full bg-bg-input flex items-center justify-center text-[9px] font-semibold">{m.displayName.slice(0, 2).toUpperCase()}</div>}
          />
          <span
            className="truncate font-medium"
            style={m.roleColor ? { color: m.roleColor } : undefined}
          >{m.displayName}</span>
          <span className="text-fg-dim truncate">@{m.username}</span>
        </div>
        <div className="w-[120px] text-fg-dim shrink-0">{formatDate(m.joinedAt)}</div>
        <div className="w-[120px] text-fg-dim shrink-0">{formatDate(m.createdAt)}</div>
        <div className="flex-1 min-w-0 flex items-center gap-1 truncate" title={m.roleIds.map(id => rolesById.get(id)?.name).filter(Boolean).join(', ')}>
          {m.roleIds.slice(0, 3).map(id => {
            const r = rolesById.get(id);
            if (!r) return null;
            return (
              <span
                key={id}
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: r.color ?? 'rgba(255,255,255,0.2)' }}
              />
            );
          })}
          {m.roleIds.length > 3 && <span className="text-fg-dim text-[11px] ml-1">+{m.roleIds.length - 3}</span>}
        </div>
        <button
          type="button"
          onClick={(e) => onMore(e, m)}
          className="shrink-0 p-1 rounded hover:bg-hover text-fg-dim hover:text-fg"
          aria-label="Actions"
        >
          <IconDots size={16} />
        </button>
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center px-4 gap-3 h-9 text-[12px] uppercase tracking-wide font-semibold border-b border-white/[0.04] text-fg-dim shrink-0">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => { if (el) el.indeterminate = someSelected; }}
          onChange={onToggleAllFiltered}
          className="shrink-0"
          aria-label="Select all"
        />
        <div className="w-[260px]">{headerCol('Name', 'name')}</div>
        <div className="w-[120px] shrink-0">{headerCol('Member since', 'joinedAt')}</div>
        <div className="w-[120px] shrink-0">{headerCol('Joined Discord', 'createdAt')}</div>
        <div className="flex-1 min-w-0">{headerCol('Roles', null)}</div>
        <div className="w-6 shrink-0" />
      </div>
      <div className="flex-1 min-h-0">
        <AutoSizedList rowCount={rows.length} rowHeight={ROW_HEIGHT}>
          {Row}
        </AutoSizedList>
      </div>
      {modState && modState.kind === 'kick'    && <KickDialog    guildId={guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
      {modState && modState.kind === 'ban'     && <BanDialog     guildId={guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
      {modState && modState.kind === 'timeout' && <TimeoutDialog guildId={guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
    </div>
  );
}

// Tiny wrapper that observes its container size and renders a FixedSizeList.
// Uses ResizeObserver so it adapts to window/sidebar changes.
function AutoSizedList({
  rowCount, rowHeight, children,
}: {
  rowCount: number;
  rowHeight: number;
  children: (p: ListChildComponentProps) => JSX.Element;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <div
      className="w-full h-full"
      ref={(el) => {
        if (!el) return;
        const ro = new ResizeObserver(entries => {
          const r = entries[0]?.contentRect;
          if (r) setSize({ w: r.width, h: r.height });
        });
        ro.observe(el);
      }}
    >
      {size && (
        <FixedSizeList
          width={size.w}
          height={size.h}
          itemCount={rowCount}
          itemSize={rowHeight}
        >
          {children}
        </FixedSizeList>
      )}
    </div>
  );
}

```

- [ ] **Step 2: Wire MembersTable into MembersDirectory**

In `src/renderer/components/MembersDirectory.tsx`, replace the placeholder `<ul>` block AND the now-unused hidden marker with the real table. Specifically:

Add imports at the top:
```tsx
import { MembersTable, type SortKey } from './members/MembersTable';
```

Build a `rolesById` map via `useMemo`. Add this just below the existing `filtered` `useMemo`:

```tsx
  const rolesById = useMemo(() => {
    const m = new Map<string, GuildRole>();
    for (const r of roles) m.set(r.id, r);
    return m;
  }, [roles]);
```

Replace this block:
```tsx
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Table mounts here in Task 10. Scaffold list for now: */}
        <ul className="p-4 space-y-1 text-[13px]">
          {filtered.slice(0, 50).map(e => (
            <li key={e.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.has(e.id)}
                onChange={() => setSelected(prev => {
                  const next = new Set(prev);
                  if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
                  return next;
                })}
              />
              <span style={e.roleColor ? { color: e.roleColor } : undefined}>{e.displayName}</span>
              <span className="text-fg-dim">@{e.username}</span>
            </li>
          ))}
          {filtered.length > 50 && <li className="text-fg-dim">…and {filtered.length - 50} more (table coming in Task 10)</li>}
        </ul>
      </div>
```

with:
```tsx
      <MembersTable
        guildId={guildId}
        rows={filtered}
        selected={selected}
        onToggleSelected={(id) => setSelected(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        })}
        onToggleAllFiltered={() => setSelected(prev => {
          const allChecked = filtered.length > 0 && filtered.every(r => prev.has(r.id));
          if (allChecked) {
            const next = new Set(prev);
            for (const r of filtered) next.delete(r.id);
            return next;
          }
          const next = new Set(prev);
          for (const r of filtered) next.add(r.id);
          return next;
        })}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(k: SortKey) => {
          if (k === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
          else { setSortKey(k); setSortDir('desc'); }
        }}
        rolesById={rolesById}
      />
```

Delete the second `<span className="hidden">` marker now that `setSortKey` and `setSortDir` are referenced. Also delete the placeholder selection footer (the `{selected.size > 0 && ...}` block) — Task 13 replaces it.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/members/MembersTable.tsx src/renderer/components/MembersDirectory.tsx
git commit -m "feat(members): virtualized table with sort, selection, per-row context menu"
```

---

## Task 11: BulkRoleDialog (add + remove modes)

**Files:**
- Create: `src/renderer/components/members/BulkRoleDialog.tsx`

- [ ] **Step 1: Create the dialog**

```tsx
// src/renderer/components/members/BulkRoleDialog.tsx
import { useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { api } from '../../lib/api';
import { pushToast } from '../Toaster';
import type { GuildRole, BulkActionResult } from '../../../shared/domain';

export function BulkRoleDialog({
  mode, guildId, userIds, roles, onClose, onSuccess,
}: {
  mode: 'add' | 'remove';
  guildId: string;
  userIds: string[];
  roles: GuildRole[];
  onClose: () => void;
  onSuccess: (result: BulkActionResult) => void;
}) {
  const [roleId, setRoleId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const assignable = roles.filter(r => !r.managed);

  const submit = async () => {
    if (!roleId) return;
    setBusy(true);
    const res = mode === 'add'
      ? await api.guilds.bulkAssignRole(guildId, userIds, roleId)
      : await api.guilds.bulkRemoveRole(guildId, userIds, roleId);
    setBusy(false);
    if (!res.ok) {
      pushToast('danger', res.error.message);
      return;
    }
    const r = res.data;
    pushToast(
      r.failed.length === 0 ? 'ok' : 'warn',
      `${mode === 'add' ? 'Assigned' : 'Removed'} role on ${r.ok.length} member(s)${r.failed.length ? `, ${r.failed.length} failed` : ''}`,
    );
    onSuccess(r);
    onClose();
  };

  return (
    <ConfirmDialog
      title={`${mode === 'add' ? 'Add' : 'Remove'} role on ${userIds.length} member${userIds.length === 1 ? '' : 's'}`}
      confirmLabel={mode === 'add' ? 'Add role' : 'Remove role'}
      danger={mode === 'remove'}
      busy={busy}
      onCancel={onClose}
      onConfirm={submit}
    >
      <label className="block text-[12px] text-fg-dim mb-1">Role</label>
      <select
        value={roleId}
        onChange={(e) => setRoleId(e.target.value)}
        className="w-full px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
      >
        <option value="">Select a role…</option>
        {assignable.map(r => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
    </ConfirmDialog>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/members/BulkRoleDialog.tsx
git commit -m "feat(members): add bulk role add/remove dialog"
```

---

## Task 12: BulkKickDialog + BulkBanDialog

**Files:**
- Create: `src/renderer/components/members/BulkKickDialog.tsx`
- Create: `src/renderer/components/members/BulkBanDialog.tsx`

- [ ] **Step 1: BulkKickDialog**

```tsx
// src/renderer/components/members/BulkKickDialog.tsx
import { useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { api } from '../../lib/api';
import { pushToast } from '../Toaster';
import type { BulkActionResult } from '../../../shared/domain';

export function BulkKickDialog({
  guildId, userIds, onClose, onSuccess,
}: {
  guildId: string;
  userIds: string[];
  onClose: () => void;
  onSuccess: (result: BulkActionResult) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await api.guilds.bulkKickMembers(guildId, userIds, reason.trim() || undefined);
    setBusy(false);
    if (!res.ok) { pushToast('danger', res.error.message); return; }
    const r = res.data;
    pushToast(
      r.failed.length === 0 ? 'ok' : 'warn',
      `Kicked ${r.ok.length} member(s)${r.failed.length ? `, ${r.failed.length} failed` : ''}`,
    );
    onSuccess(r);
    onClose();
  };

  return (
    <ConfirmDialog
      title={`Kick ${userIds.length} member${userIds.length === 1 ? '' : 's'}?`}
      description="They will be removed from the server but can rejoin with a new invite."
      confirmLabel="Kick"
      busy={busy}
      onCancel={onClose}
      onConfirm={submit}
    >
      <label className="block text-[12px] text-fg-dim mb-1">Reason (optional, shown in audit log)</label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 512))}
        maxLength={512}
        className="w-full px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
        placeholder="Why are you kicking them?"
      />
    </ConfirmDialog>
  );
}
```

- [ ] **Step 2: BulkBanDialog**

```tsx
// src/renderer/components/members/BulkBanDialog.tsx
import { useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { api } from '../../lib/api';
import { pushToast } from '../Toaster';
import type { BulkActionResult } from '../../../shared/domain';

const HISTORY_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: "Don't delete any", seconds: 0 },
  { label: 'Last hour', seconds: 60 * 60 },
  { label: 'Last 6 hours', seconds: 6 * 60 * 60 },
  { label: 'Last 12 hours', seconds: 12 * 60 * 60 },
  { label: 'Last 24 hours', seconds: 24 * 60 * 60 },
  { label: 'Last 3 days', seconds: 3 * 24 * 60 * 60 },
  { label: 'Last 7 days', seconds: 7 * 24 * 60 * 60 },
];

export function BulkBanDialog({
  guildId, userIds, onClose, onSuccess,
}: {
  guildId: string;
  userIds: string[];
  onClose: () => void;
  onSuccess: (result: BulkActionResult) => void;
}) {
  const [reason, setReason] = useState('');
  const [historySeconds, setHistorySeconds] = useState(0);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await api.guilds.bulkBanMembers(guildId, userIds, {
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      deleteMessageSeconds: historySeconds,
    });
    setBusy(false);
    if (!res.ok) { pushToast('danger', res.error.message); return; }
    const r = res.data;
    pushToast(
      r.failed.length === 0 ? 'ok' : 'warn',
      `Banned ${r.ok.length} member(s)${r.failed.length ? `, ${r.failed.length} failed` : ''}`,
    );
    onSuccess(r);
    onClose();
  };

  return (
    <ConfirmDialog
      title={`Ban ${userIds.length} member${userIds.length === 1 ? '' : 's'}?`}
      description="They will be removed and prevented from rejoining."
      confirmLabel="Ban"
      busy={busy}
      onCancel={onClose}
      onConfirm={submit}
    >
      <label className="block text-[12px] text-fg-dim mb-1">Reason (optional, shown in audit log)</label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 512))}
        maxLength={512}
        className="w-full px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
        placeholder="Why are you banning them?"
      />
      <label className="block text-[12px] text-fg-dim mb-1 mt-3">Delete message history</label>
      <select
        value={historySeconds}
        onChange={(e) => setHistorySeconds(Number(e.target.value))}
        className="w-full px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
      >
        {HISTORY_OPTIONS.map(o => (
          <option key={o.seconds} value={o.seconds}>{o.label}</option>
        ))}
      </select>
    </ConfirmDialog>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/members/BulkKickDialog.tsx src/renderer/components/members/BulkBanDialog.tsx
git commit -m "feat(members): add bulk kick + bulk ban dialogs"
```

---

## Task 13: MembersBulkBar wiring

**Files:**
- Create: `src/renderer/components/members/MembersBulkBar.tsx`
- Modify: `src/renderer/components/MembersDirectory.tsx`

- [ ] **Step 1: Create the bulk bar**

```tsx
// src/renderer/components/members/MembersBulkBar.tsx
import { useState } from 'react';
import { BulkRoleDialog } from './BulkRoleDialog';
import { BulkKickDialog } from './BulkKickDialog';
import { BulkBanDialog } from './BulkBanDialog';
import type { GuildRole, BulkActionResult } from '../../../shared/domain';

type DialogState =
  | { kind: 'addRole' | 'removeRole' }
  | { kind: 'kick' }
  | { kind: 'ban' }
  | null;

export function MembersBulkBar({
  guildId, selectedIds, roles, onClear, onActionComplete,
}: {
  guildId: string;
  selectedIds: string[];
  roles: GuildRole[];
  onClear: () => void;
  onActionComplete: (result: BulkActionResult) => void;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  if (selectedIds.length === 0) return null;

  return (
    <>
      <div className="px-4 py-3 border-t border-white/[0.04] bg-bg flex items-center gap-2">
        <span className="text-fg text-[13px]">{selectedIds.length} selected</span>
        <button onClick={onClear} className="text-fg-dim text-[12px] hover:text-fg">Clear</button>
        <div className="flex-1" />
        <button
          onClick={() => setDialog({ kind: 'addRole' })}
          className="px-3 py-1.5 rounded text-[13px] bg-bg-input hover:bg-hover text-fg"
        >Add role</button>
        <button
          onClick={() => setDialog({ kind: 'removeRole' })}
          className="px-3 py-1.5 rounded text-[13px] bg-bg-input hover:bg-hover text-fg"
        >Remove role</button>
        <button
          onClick={() => setDialog({ kind: 'kick' })}
          className="px-3 py-1.5 rounded text-[13px] bg-danger/20 hover:bg-danger/40 text-danger"
        >Kick</button>
        <button
          onClick={() => setDialog({ kind: 'ban' })}
          className="px-3 py-1.5 rounded text-[13px] bg-danger hover:bg-danger/80 text-white"
        >Ban</button>
      </div>
      {dialog?.kind === 'addRole' && (
        <BulkRoleDialog
          mode="add"
          guildId={guildId}
          userIds={selectedIds}
          roles={roles}
          onClose={() => setDialog(null)}
          onSuccess={onActionComplete}
        />
      )}
      {dialog?.kind === 'removeRole' && (
        <BulkRoleDialog
          mode="remove"
          guildId={guildId}
          userIds={selectedIds}
          roles={roles}
          onClose={() => setDialog(null)}
          onSuccess={onActionComplete}
        />
      )}
      {dialog?.kind === 'kick' && (
        <BulkKickDialog
          guildId={guildId}
          userIds={selectedIds}
          onClose={() => setDialog(null)}
          onSuccess={onActionComplete}
        />
      )}
      {dialog?.kind === 'ban' && (
        <BulkBanDialog
          guildId={guildId}
          userIds={selectedIds}
          onClose={() => setDialog(null)}
          onSuccess={onActionComplete}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Wire into MembersDirectory**

Add import in `src/renderer/components/MembersDirectory.tsx`:
```tsx
import { MembersBulkBar } from './members/MembersBulkBar';
```

After the `<MembersTable .../>` JSX, add:

```tsx
      <MembersBulkBar
        guildId={guildId}
        selectedIds={Array.from(selected).filter(id => entries.find(e => e.id === id && !e.isBot))}
        roles={roles}
        onClear={() => setSelected(new Set())}
        onActionComplete={() => {
          setSelected(new Set());
          // Refresh cached members so role changes / kicks / bans are reflected.
          cache.current.delete(guildId);
          api.guilds.listAllMembers(guildId).then(res => {
            if (res.ok) {
              cache.current.set(guildId, res.data);
              setEntries(res.data.entries);
              setIntentMissing(res.data.intentMissing);
            }
          });
        }}
      />
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/members/MembersBulkBar.tsx src/renderer/components/MembersDirectory.tsx
git commit -m "feat(members): wire bulk action bar with role/kick/ban dialogs"
```

---

## Task 14: Manual smoke test

This task has no commits — it's the verification gate before declaring the feature done.

- [ ] **Step 1: Run dev**

Run: `npm run dev`

- [ ] **Step 2: Members entry**

- Click **Members** above the channel list → main pane swaps to the directory
- Pick a different server, then come back — last view (channel or members) is restored per guild
- Member count appears next to the Members label

- [ ] **Step 3: Loading + intent banner**

- Disable the Server Members Intent in the Discord Developer Portal, restart the bot — directory shows the warn banner; only cached members appear
- Re-enable it — full member list loads on next directory open

- [ ] **Step 4: Search + sort + role filter**

- Search box filters live as you type (display name + username)
- Click a column header — sort order toggles asc/desc; chevron indicates active column
- Pick a role from the filter dropdown — only members with that role render
- Member count in the toolbar reflects the filtered count

- [ ] **Step 5: Selection**

- Master checkbox toggles all currently-filtered rows
- Master shows indeterminate state when only some rows are selected
- Selecting/deselecting individual rows works
- Selection survives sort/search changes
- Switching guilds clears selection

- [ ] **Step 6: Per-row ⋯ menu**

- Click the ⋯ button → user context menu opens with the same items as the sidebar/message author menu
- Disabled states behave correctly when bot lacks ManageRoles / outranks target / etc.

- [ ] **Step 7: Bulk actions**

- Select 5+ members → bulk bar appears at the bottom
- Add role → choose a role → confirms, toast shows N succeeded / X failed; member roles update on refresh
- Remove role → same flow
- Kick on a couple of test members → confirms, members are kicked; bulk bar clears
- Ban 1-3 test accounts (skip if no test accounts available) → confirms, accounts banned; verify in audit log

- [ ] **Step 8: Run full test suite + typecheck + lint**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all PASS.

- [ ] **Step 9: Final commit if cleanup needed**

If smoke testing surfaced any issues, fix them and commit. Otherwise the previous commits stand.

---

## Self-Review Notes

- **Spec coverage:** All sections covered — Members entry (Task 7), directory shell with intent banner (Task 8), toolbar (Task 9), virtualized table with sort and selection (Task 10), per-row context menu (Task 10's ⋯ wiring), bulk action bar (Task 13), bulk dialogs (Tasks 11-12), IPC handlers (Tasks 3-5), preload (Task 6), types and contract (Task 1), react-window dep (Task 2), manual test (Task 14).
- **Type consistency:** `AllMembersEntry`, `BulkActionResult`, `ListAllMembersResult`, `SortKey`, `SortDir` consistent across tasks. `BotCapabilities`, `GuildRole`, `MemberDetail` reused from earlier work.
- **Known soft spots:** The hidden `<span>` markers in Task 8 are transient and removed in Tasks 9-10. Task 10's `void updateContextMenuItems;` line is a deliberate no-op to keep the import for future use; implementer should leave it or remove the import if they prefer — the call site is purely defensive.
- **Edge case from spec — bot in selection:** the bulk bar filters out `isBot` entries before passing IDs to dialogs (Task 13's `selectedIds={...}.filter(...)`).
- **Edge case from spec — refetch after bulk:** `onActionComplete` clears the cache and refetches (Task 13).
