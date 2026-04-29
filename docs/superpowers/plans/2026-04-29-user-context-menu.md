# User Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click context menu on members (sidebar + message authors) with role management, moderation actions (kick/ban/timeout), and convenience items, gated by Discord permission and role-hierarchy checks.

**Architecture:** A `buildUserMenu()` factory produces `ContextMenuEntry[]` consumed by the existing `ContextMenu` component (extended with submenu support). New IPC handlers in `src/main/ipc/guilds.ts` cover `listGuildRoles`, `getBotCapabilities`, `assignRole`, `removeRole`, `kickMember`, `banMember`, `timeoutMember`. A new `ConfirmDialog` modal component backs three thin wrappers for the moderation flows.

**Tech Stack:** Electron + React + TypeScript, discord.js 14, vitest.

**Spec:** `docs/superpowers/specs/2026-04-29-user-context-menu-design.md`

---

## File Structure

**New files:**
- `src/renderer/components/UserContextMenu.ts` — `buildUserMenu()` factory
- `src/renderer/components/ConfirmDialog.tsx` — generic modal shell
- `src/renderer/components/moderation/TimeoutDialog.tsx`
- `src/renderer/components/moderation/KickDialog.tsx`
- `src/renderer/components/moderation/BanDialog.tsx`
- `src/main/discord/__tests__/permissions-capability.test.ts` — tests for capability helpers

**Modified files:**
- `src/main/discord/permissions.ts` — add flags to bitfield, add capability helpers
- `src/main/ipc/guilds.ts` — 7 new handlers
- `src/shared/ipc-contract.ts` — new channel constants and `BotcordApi` entries
- `src/shared/domain.ts` — `GuildRole`, `BotCapabilities` types
- `src/preload/expose.ts` — bind new handlers
- `src/renderer/components/ContextMenu.tsx` — submenu support on `ContextMenuEntry`
- `src/renderer/components/MemberList.tsx` — wire `onContextMenu` on `MemberRow`
- `src/renderer/components/MessageGroup.tsx` — wire `onContextMenu` on author avatar/name
- `src/renderer/components/UserProfileCard.tsx` — accept optional `roles` override for optimistic updates (Task 11 only — minimal change)

---

## Task 1: Shared types + IPC channel constants

**Files:**
- Modify: `src/shared/domain.ts` (append at end)
- Modify: `src/shared/ipc-contract.ts:105-163` (add channels and API entries)

- [ ] **Step 1: Add domain types**

Append to `src/shared/domain.ts`:

```ts
export type GuildRole = {
  id: string;
  name: string;
  color: string | null;        // "#rrggbb" or null
  position: number;
  managed: boolean;            // true for integration/bot-owned roles
  iconUrl: string | null;
  unicodeEmoji: string | null;
};

export type BotCapabilities = {
  canManageRoles: boolean;
  canKick: boolean;
  canBan: boolean;
  canTimeout: boolean;
  outranksTarget: boolean;
  botTopRolePosition: number;
  targetTopRolePosition: number;
  // Human-readable names of permissions the bot lacks (e.g., "Manage Roles").
  // Empty when the bot has all four moderation/role perms.
  missingPermissions: string[];
  // True when the target IS the bot itself — UI should hide self-actions.
  targetIsSelf: boolean;
};
```

- [ ] **Step 2: Add IPC channel constants**

In `src/shared/ipc-contract.ts`, inside the `IPC_CHANNELS` object (after `'guilds.listArchivedForumPosts'`), add:

```ts
  'guilds.listGuildRoles': 'guilds.listGuildRoles',
  'guilds.getBotCapabilities': 'guilds.getBotCapabilities',
  'guilds.assignRole': 'guilds.assignRole',
  'guilds.removeRole': 'guilds.removeRole',
  'guilds.kickMember': 'guilds.kickMember',
  'guilds.banMember': 'guilds.banMember',
  'guilds.timeoutMember': 'guilds.timeoutMember',
```

- [ ] **Step 3: Update BotcordApi interface**

In `src/shared/ipc-contract.ts`, add `GuildRole, BotCapabilities` to the import from `./domain`, then inside `guilds: { ... }` (after `listArchivedForumPosts`) add:

```ts
    listGuildRoles(guildId: string): Promise<Result<GuildRole[]>>;
    getBotCapabilities(guildId: string, targetUserId: string): Promise<Result<BotCapabilities>>;
    assignRole(guildId: string, userId: string, roleId: string): Promise<Result<void>>;
    removeRole(guildId: string, userId: string, roleId: string): Promise<Result<void>>;
    kickMember(guildId: string, userId: string, reason?: string): Promise<Result<void>>;
    banMember(guildId: string, userId: string, opts: { reason?: string; deleteMessageSeconds?: number }): Promise<Result<void>>;
    timeoutMember(guildId: string, userId: string, durationMs: number, reason?: string): Promise<Result<void>>;
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (it's fine for renderer/main to not implement these yet — only the contract file is consumed at compile time, but types in `BotcordApi` are referenced via `window.botcord` which is implemented in preload. Typecheck may surface preload mismatch — that's fixed in Task 6.)

If typecheck fails on `src/preload/expose.ts`, that's expected; proceed and Task 6 will resolve it. If it fails elsewhere, fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/shared/domain.ts src/shared/ipc-contract.ts
git commit -m "feat(ipc): add user context menu IPC contract types"
```

---

## Task 2: Add new permission flags to bot bitfield

**Files:**
- Modify: `src/main/discord/permissions.ts:3-13`
- Modify: `src/main/discord/__tests__/permissions.test.ts` (add assertion)

- [ ] **Step 1: Update existing test to assert the new flags are included**

Append to `src/main/discord/__tests__/permissions.test.ts` inside `describe('permissions', ...)`:

```ts
  it('includes role management and moderation flags in the bitfield', () => {
    const bf = BigInt(BOT_PERMISSIONS_BITFIELD);
    // PermissionFlagsBits values from discord.js
    const ManageRoles      = 1n << 28n;
    const KickMembers      = 1n << 1n;
    const BanMembers       = 1n << 2n;
    const ModerateMembers  = 1n << 40n;
    expect(bf & ManageRoles).toBe(ManageRoles);
    expect(bf & KickMembers).toBe(KickMembers);
    expect(bf & BanMembers).toBe(BanMembers);
    expect(bf & ModerateMembers).toBe(ModerateMembers);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/discord/__tests__/permissions.test.ts`
Expected: FAIL on the new test (current bitfield is missing those flags).

- [ ] **Step 3: Add the flags to REQUIRED_PERMISSIONS**

In `src/main/discord/permissions.ts`, update `REQUIRED_PERMISSIONS`:

```ts
const REQUIRED_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
];
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run src/main/discord/__tests__/permissions.test.ts`
Expected: PASS all tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/discord/permissions.ts src/main/discord/__tests__/permissions.test.ts
git commit -m "feat(permissions): request ManageRoles/Kick/Ban/ModerateMembers in invite URL"
```

---

## Task 3: Capability + hierarchy helpers (pure, TDD)

**Files:**
- Modify: `src/main/discord/permissions.ts` (append)
- Create: `src/main/discord/__tests__/permissions-capability.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/discord/__tests__/permissions-capability.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { computeBotCapabilities, missingPermissionNames } from '../permissions';

// Minimal fakes shaped like what the real helpers consume — no discord.js
// objects required. Helpers are written to accept this narrower shape.
type FakeMember = {
  id: string;
  // Bitfield of granted permissions as a bigint
  permissionsBitfield: bigint;
  // Position of the highest role
  topRolePosition: number;
};

const ALL_PERMS =
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ModerateMembers;

const NO_PERMS = 0n;

describe('computeBotCapabilities', () => {
  it('returns all-true caps when bot has all perms and outranks target', () => {
    const bot: FakeMember    = { id: 'B', permissionsBitfield: ALL_PERMS, topRolePosition: 10 };
    const target: FakeMember = { id: 'T', permissionsBitfield: NO_PERMS, topRolePosition: 5 };
    const caps = computeBotCapabilities(bot, target);
    expect(caps.canManageRoles).toBe(true);
    expect(caps.canKick).toBe(true);
    expect(caps.canBan).toBe(true);
    expect(caps.canTimeout).toBe(true);
    expect(caps.outranksTarget).toBe(true);
    expect(caps.missingPermissions).toEqual([]);
    expect(caps.targetIsSelf).toBe(false);
  });

  it('disables all action caps when bot does not outrank target (equal positions)', () => {
    const bot: FakeMember    = { id: 'B', permissionsBitfield: ALL_PERMS, topRolePosition: 5 };
    const target: FakeMember = { id: 'T', permissionsBitfield: NO_PERMS, topRolePosition: 5 };
    const caps = computeBotCapabilities(bot, target);
    expect(caps.canManageRoles).toBe(false);
    expect(caps.canKick).toBe(false);
    expect(caps.canBan).toBe(false);
    expect(caps.canTimeout).toBe(false);
    expect(caps.outranksTarget).toBe(false);
    // Permissions are present — only hierarchy is the issue, so no missing perms
    expect(caps.missingPermissions).toEqual([]);
  });

  it('disables only the missing permission cap', () => {
    const bot: FakeMember = {
      id: 'B',
      permissionsBitfield: ALL_PERMS & ~PermissionFlagsBits.BanMembers,
      topRolePosition: 10,
    };
    const target: FakeMember = { id: 'T', permissionsBitfield: NO_PERMS, topRolePosition: 5 };
    const caps = computeBotCapabilities(bot, target);
    expect(caps.canManageRoles).toBe(true);
    expect(caps.canKick).toBe(true);
    expect(caps.canBan).toBe(false);
    expect(caps.canTimeout).toBe(true);
    expect(caps.missingPermissions).toEqual(['Ban Members']);
  });

  it('marks targetIsSelf when target id matches bot id', () => {
    const bot: FakeMember    = { id: 'X', permissionsBitfield: ALL_PERMS, topRolePosition: 10 };
    const caps = computeBotCapabilities(bot, { id: 'X', permissionsBitfield: NO_PERMS, topRolePosition: 1 });
    expect(caps.targetIsSelf).toBe(true);
  });
});

describe('missingPermissionNames', () => {
  it('lists human-readable names of missing flags from the moderation set', () => {
    const granted = PermissionFlagsBits.ManageRoles | PermissionFlagsBits.KickMembers;
    expect(missingPermissionNames(granted)).toEqual(['Ban Members', 'Timeout Members']);
  });

  it('returns empty when all four moderation perms are granted', () => {
    expect(missingPermissionNames(ALL_PERMS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/main/discord/__tests__/permissions-capability.test.ts`
Expected: FAIL — `computeBotCapabilities`/`missingPermissionNames` not exported.

- [ ] **Step 3: Implement helpers**

Append to `src/main/discord/permissions.ts`:

```ts
import type { BotCapabilities } from '../../shared/domain';

// Narrow shape — accepts either a real GuildMember or a test fake.
export type CapabilitySubject = {
  id: string;
  permissionsBitfield: bigint;
  topRolePosition: number;
};

const MOD_PERM_NAMES: Array<[bigint, string]> = [
  [PermissionFlagsBits.ManageRoles,     'Manage Roles'],
  [PermissionFlagsBits.KickMembers,     'Kick Members'],
  [PermissionFlagsBits.BanMembers,      'Ban Members'],
  [PermissionFlagsBits.ModerateMembers, 'Timeout Members'],
];

export function missingPermissionNames(granted: bigint): string[] {
  const out: string[] = [];
  for (const [flag, name] of MOD_PERM_NAMES) {
    if ((granted & flag) === 0n) out.push(name);
  }
  return out;
}

export function computeBotCapabilities(
  bot: CapabilitySubject,
  target: CapabilitySubject,
): BotCapabilities {
  const has = (flag: bigint) => (bot.permissionsBitfield & flag) === flag;
  const outranks = bot.topRolePosition > target.topRolePosition;
  return {
    canManageRoles: has(PermissionFlagsBits.ManageRoles)     && outranks,
    canKick:        has(PermissionFlagsBits.KickMembers)     && outranks,
    canBan:         has(PermissionFlagsBits.BanMembers)      && outranks,
    canTimeout:     has(PermissionFlagsBits.ModerateMembers) && outranks,
    outranksTarget: outranks,
    botTopRolePosition: bot.topRolePosition,
    targetTopRolePosition: target.topRolePosition,
    missingPermissions: missingPermissionNames(bot.permissionsBitfield),
    targetIsSelf: bot.id === target.id,
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run src/main/discord/__tests__/permissions-capability.test.ts`
Expected: PASS all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/discord/permissions.ts src/main/discord/__tests__/permissions-capability.test.ts
git commit -m "feat(permissions): add computeBotCapabilities + missingPermissionNames helpers"
```

---

## Task 4: IPC handlers — listGuildRoles + getBotCapabilities

**Files:**
- Modify: `src/main/ipc/guilds.ts` (append two handlers inside `registerGuildHandlers`)

- [ ] **Step 1: Add `listGuildRoles` handler**

In `src/main/ipc/guilds.ts`, add `GuildRole, BotCapabilities` to the import from `../../shared/domain`, then add this handler before the closing `}` of `registerGuildHandlers`:

```ts
  ipcMain.handle(IPC_CHANNELS['guilds.listGuildRoles'], async (_, guildId: unknown): Promise<Result<GuildRole[]>> => {
    if (typeof guildId !== 'string') return err('INTERNAL', 'guildId must be a string');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);

    const roles: GuildRole[] = guild.roles.cache
      .filter(r => r.id !== guild.id) // exclude @everyone
      .sort((a, b) => b.position - a.position)
      .map(r => ({
        id: r.id,
        name: r.name,
        color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
        position: r.position,
        managed: r.managed,
        iconUrl: r.iconURL({ size: 32 }),
        unicodeEmoji: r.unicodeEmoji ?? null,
      }));
    return ok(roles);
  });
```

- [ ] **Step 2: Add `getBotCapabilities` handler**

Add after the previous handler:

```ts
  ipcMain.handle(IPC_CHANNELS['guilds.getBotCapabilities'], async (_, guildId: unknown, targetUserId: unknown): Promise<Result<BotCapabilities>> => {
    if (typeof guildId !== 'string' || typeof targetUserId !== 'string') return err('INTERNAL', 'guildId and targetUserId required');
    const client = manager.getClient();
    if (!client || !client.isReady() || !client.user) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);

    const botMember = guild.members.cache.get(client.user.id) ?? await guild.members.fetch(client.user.id).catch(() => null);
    if (!botMember) return err('NOT_FOUND', 'Bot member not found in guild');

    let target: GuildMember | undefined = guild.members.cache.get(targetUserId);
    if (!target) { try { target = await guild.members.fetch(targetUserId); } catch { /* fall through */ } }
    if (!target) return err('NOT_FOUND', `Member ${targetUserId} not found`);

    const caps = computeBotCapabilities(
      { id: botMember.id, permissionsBitfield: botMember.permissions.bitfield, topRolePosition: botMember.roles.highest.position },
      { id: target.id,    permissionsBitfield: target.permissions.bitfield,    topRolePosition: target.roles.highest.position },
    );
    return ok(caps);
  });
```

Add the import at the top of `src/main/ipc/guilds.ts`:

```ts
import { computeBotCapabilities } from '../discord/permissions';
```

- [ ] **Step 3: Register handlers in main process bootstrap**

The handlers are registered automatically inside `registerGuildHandlers` — no separate registration needed. Verify by reading `src/main/ipc/index.ts` to confirm `registerGuildHandlers` is called once.

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS for `src/main/**` (preload may still error — fixed in Task 6).

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/guilds.ts
git commit -m "feat(ipc): add listGuildRoles + getBotCapabilities handlers"
```

---

## Task 5: IPC handlers — assignRole + removeRole

**Files:**
- Modify: `src/main/ipc/guilds.ts` (append two handlers)

- [ ] **Step 1: Add a guard helper at top of `registerGuildHandlers`**

This guard re-checks hierarchy and ManageRoles on the main process side as defense in depth. Add inside `registerGuildHandlers` just after the opening `{`:

```ts
  // Returns null if everything is fine, or a Result error if not.
  async function assertCanManageRoleOnTarget(guildId: string, targetUserId: string, roleId: string): Promise<{ guild: import('discord.js').Guild; target: GuildMember; role: import('discord.js').Role } | Result<never>> {
    const client = manager.getClient();
    if (!client || !client.isReady() || !client.user) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);
    const botMember = guild.members.cache.get(client.user.id) ?? await guild.members.fetch(client.user.id).catch(() => null);
    if (!botMember) return err('NOT_FOUND', 'Bot member not found in guild');
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return err('FORBIDDEN', 'Bot is missing the Manage Roles permission');
    }
    const role = guild.roles.cache.get(roleId);
    if (!role) return err('NOT_FOUND', `Role ${roleId} not found`);
    if (role.managed) return err('FORBIDDEN', 'Cannot assign integration-managed roles');
    if (role.position >= botMember.roles.highest.position) {
      return err('FORBIDDEN', "Role is at or above the bot's highest role");
    }
    let target: GuildMember | undefined = guild.members.cache.get(targetUserId);
    if (!target) { try { target = await guild.members.fetch(targetUserId); } catch { /* fall */ } }
    if (!target) return err('NOT_FOUND', `Member ${targetUserId} not found`);
    if (target.roles.highest.position >= botMember.roles.highest.position) {
      return err('FORBIDDEN', "Target's highest role is at or above the bot's highest role");
    }
    return { guild, target, role };
  }
```

- [ ] **Step 2: Add `assignRole` handler**

```ts
  ipcMain.handle(IPC_CHANNELS['guilds.assignRole'], async (_, guildId: unknown, userId: unknown, roleId: unknown): Promise<Result<void>> => {
    if (typeof guildId !== 'string' || typeof userId !== 'string' || typeof roleId !== 'string') return err('INTERNAL', 'guildId, userId, roleId required');
    const guard = await assertCanManageRoleOnTarget(guildId, userId, roleId);
    if ('ok' in guard) return guard;
    try {
      await guard.target.roles.add(guard.role, 'Assigned via BotCord');
      return ok(undefined);
    } catch (e) {
      return err('DISCORD_ERROR', e instanceof Error ? e.message : 'Failed to assign role');
    }
  });
```

- [ ] **Step 3: Add `removeRole` handler**

```ts
  ipcMain.handle(IPC_CHANNELS['guilds.removeRole'], async (_, guildId: unknown, userId: unknown, roleId: unknown): Promise<Result<void>> => {
    if (typeof guildId !== 'string' || typeof userId !== 'string' || typeof roleId !== 'string') return err('INTERNAL', 'guildId, userId, roleId required');
    const guard = await assertCanManageRoleOnTarget(guildId, userId, roleId);
    if ('ok' in guard) return guard;
    try {
      await guard.target.roles.remove(guard.role, 'Removed via BotCord');
      return ok(undefined);
    } catch (e) {
      return err('DISCORD_ERROR', e instanceof Error ? e.message : 'Failed to remove role');
    }
  });
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS for `src/main/**`. If `Result<never>` is missing the `'ok'` property, check `src/shared/errors.ts` — the existing `err()` shape is `{ ok: false, ... }`, so the `'ok' in guard` check will work.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/guilds.ts
git commit -m "feat(ipc): add assignRole + removeRole handlers with hierarchy guard"
```

---

## Task 6: IPC handlers — kickMember + banMember + timeoutMember

**Files:**
- Modify: `src/main/ipc/guilds.ts` (append three handlers)

- [ ] **Step 1: Add a moderation guard helper inside `registerGuildHandlers`**

Add after `assertCanManageRoleOnTarget`:

```ts
  async function assertCanModerate(
    guildId: string,
    targetUserId: string,
    requiredFlag: bigint,
    permName: string,
  ): Promise<{ target: GuildMember } | Result<never>> {
    const client = manager.getClient();
    if (!client || !client.isReady() || !client.user) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);
    const botMember = guild.members.cache.get(client.user.id) ?? await guild.members.fetch(client.user.id).catch(() => null);
    if (!botMember) return err('NOT_FOUND', 'Bot member not found in guild');
    if (!botMember.permissions.has(requiredFlag)) {
      return err('FORBIDDEN', `Bot is missing the ${permName} permission`);
    }
    let target: GuildMember | undefined = guild.members.cache.get(targetUserId);
    if (!target) { try { target = await guild.members.fetch(targetUserId); } catch { /* fall */ } }
    if (!target) return err('NOT_FOUND', `Member ${targetUserId} not found`);
    if (target.id === botMember.id) return err('FORBIDDEN', 'Cannot perform this action on the bot itself');
    if (target.roles.highest.position >= botMember.roles.highest.position) {
      return err('FORBIDDEN', "Target's highest role is at or above the bot's highest role");
    }
    return { target };
  }
```

- [ ] **Step 2: Add `kickMember` handler**

```ts
  ipcMain.handle(IPC_CHANNELS['guilds.kickMember'], async (_, guildId: unknown, userId: unknown, reason: unknown): Promise<Result<void>> => {
    if (typeof guildId !== 'string' || typeof userId !== 'string') return err('INTERNAL', 'guildId and userId required');
    const r = typeof reason === 'string' && reason.length > 0 ? reason.slice(0, 512) : undefined;
    const guard = await assertCanModerate(guildId, userId, PermissionsBitField.Flags.KickMembers, 'Kick Members');
    if ('ok' in guard) return guard;
    try {
      await guard.target.kick(r);
      return ok(undefined);
    } catch (e) {
      return err('DISCORD_ERROR', e instanceof Error ? e.message : 'Failed to kick member');
    }
  });
```

- [ ] **Step 3: Add `banMember` handler**

```ts
  ipcMain.handle(IPC_CHANNELS['guilds.banMember'], async (_, guildId: unknown, userId: unknown, opts: unknown): Promise<Result<void>> => {
    if (typeof guildId !== 'string' || typeof userId !== 'string') return err('INTERNAL', 'guildId and userId required');
    const o = (opts && typeof opts === 'object' ? opts : {}) as { reason?: string; deleteMessageSeconds?: number };
    const reason = typeof o.reason === 'string' && o.reason.length > 0 ? o.reason.slice(0, 512) : undefined;
    const dms = typeof o.deleteMessageSeconds === 'number' && o.deleteMessageSeconds >= 0 && o.deleteMessageSeconds <= 604800
      ? Math.floor(o.deleteMessageSeconds)
      : 0;
    const guard = await assertCanModerate(guildId, userId, PermissionsBitField.Flags.BanMembers, 'Ban Members');
    if ('ok' in guard) return guard;
    try {
      await guard.target.ban({ reason, deleteMessageSeconds: dms });
      return ok(undefined);
    } catch (e) {
      return err('DISCORD_ERROR', e instanceof Error ? e.message : 'Failed to ban member');
    }
  });
```

- [ ] **Step 4: Add `timeoutMember` handler**

```ts
  ipcMain.handle(IPC_CHANNELS['guilds.timeoutMember'], async (_, guildId: unknown, userId: unknown, durationMs: unknown, reason: unknown): Promise<Result<void>> => {
    if (typeof guildId !== 'string' || typeof userId !== 'string') return err('INTERNAL', 'guildId and userId required');
    if (typeof durationMs !== 'number' || durationMs <= 0 || durationMs > 28 * 24 * 60 * 60 * 1000) {
      return err('INTERNAL', 'durationMs must be > 0 and <= 28 days');
    }
    const r = typeof reason === 'string' && reason.length > 0 ? reason.slice(0, 512) : undefined;
    const guard = await assertCanModerate(guildId, userId, PermissionsBitField.Flags.ModerateMembers, 'Timeout Members');
    if ('ok' in guard) return guard;
    try {
      await guard.target.timeout(Math.floor(durationMs), r);
      return ok(undefined);
    } catch (e) {
      return err('DISCORD_ERROR', e instanceof Error ? e.message : 'Failed to timeout member');
    }
  });
```

- [ ] **Step 5: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS for `src/main/**`.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/guilds.ts
git commit -m "feat(ipc): add kick/ban/timeout member handlers with guards"
```

---

## Task 7: Preload bindings + renderer api wiring

**Files:**
- Modify: `src/preload/expose.ts:23-30` (add bindings inside `guilds:` block)

- [ ] **Step 1: Add bindings**

In `src/preload/expose.ts`, inside the `guilds:` object (after `listArchivedForumPosts`), add:

```ts
    listGuildRoles: (guildId) => invoke(IPC_CHANNELS['guilds.listGuildRoles'], guildId),
    getBotCapabilities: (guildId, targetUserId) => invoke(IPC_CHANNELS['guilds.getBotCapabilities'], guildId, targetUserId),
    assignRole: (guildId, userId, roleId) => invoke(IPC_CHANNELS['guilds.assignRole'], guildId, userId, roleId),
    removeRole: (guildId, userId, roleId) => invoke(IPC_CHANNELS['guilds.removeRole'], guildId, userId, roleId),
    kickMember: (guildId, userId, reason) => invoke(IPC_CHANNELS['guilds.kickMember'], guildId, userId, reason),
    banMember: (guildId, userId, opts) => invoke(IPC_CHANNELS['guilds.banMember'], guildId, userId, opts),
    timeoutMember: (guildId, userId, durationMs, reason) => invoke(IPC_CHANNELS['guilds.timeoutMember'], guildId, userId, durationMs, reason),
```

- [ ] **Step 2: Verify typecheck passes everywhere**

Run: `npm run typecheck`
Expected: PASS across both `tsconfig` projects.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: PASS (no new tests in this task; previous tests stay green).

- [ ] **Step 4: Commit**

```bash
git add src/preload/expose.ts
git commit -m "feat(preload): expose new user-context-menu IPC handlers"
```

---

## Task 8: ContextMenu submenu support

**Files:**
- Modify: `src/renderer/components/ContextMenu.tsx`

- [ ] **Step 1: Extend `ContextMenuEntry` and the renderer**

Replace the contents of `src/renderer/components/ContextMenu.tsx` with the following (keeps all existing behavior; adds an optional `submenu` field on item entries):

```tsx
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// One Discord-style right-click menu open at a time. Consumers don't render
// it themselves — they call openContextMenu(event, items) and we render via
// a top-level <ContextMenuHost /> mounted in the renderer root.

export type ContextMenuEntry =
  | {
      type: 'item';
      label: string;
      icon?: ReactNode;
      onClick?: () => void;
      danger?: boolean;
      disabled?: boolean;
      // When present, hovering this item opens a submenu instead of clicking.
      // onClick is ignored if submenu is non-empty.
      submenu?: ContextMenuEntry[];
      // Optional tooltip — shown via title attribute when disabled.
      title?: string;
    }
  | { type: 'separator' };

type Position = { x: number; y: number };
type State = { items: ContextMenuEntry[]; pos: Position } | null;

let setStateRef: ((s: State) => void) | null = null;
let escAttached = false;

export function openContextMenu(event: { preventDefault: () => void; clientX: number; clientY: number }, items: ContextMenuEntry[]): void {
  event.preventDefault();
  if (!setStateRef) return;
  setStateRef({ items, pos: { x: event.clientX, y: event.clientY } });
}

export function closeContextMenu(): void {
  if (setStateRef) setStateRef(null);
}

export function ContextMenuHost() {
  const [state, setState] = useState<State>(null);

  useEffect(() => {
    setStateRef = setState;
    return () => { if (setStateRef === setState) setStateRef = null; };
  }, []);

  useEffect(() => {
    if (escAttached) return;
    escAttached = true;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeContextMenu(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); escAttached = false; };
  }, []);

  if (!state) return null;
  return createPortal(<ContextMenu items={state.items} pos={state.pos} />, document.body);
}

const MIN_W = 200;
const SUBMENU_DELAY_MS = 120;

function ContextMenu({ items, pos }: { items: ContextMenuEntry[]; pos: Position }) {
  const ref = useRef<HTMLDivElement>(null);
  const [resolvedPos, setResolvedPos] = useState<Position>(pos);
  const [openSub, setOpenSub] = useState<{ index: number; rect: DOMRect } | null>(null);
  const hoverTimer = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let { x, y } = pos;
    if (x + rect.width + margin > window.innerWidth) x = Math.max(margin, window.innerWidth - rect.width - margin);
    if (y + rect.height + margin > window.innerHeight) y = Math.max(margin, window.innerHeight - rect.height - margin);
    setResolvedPos({ x, y });
  }, [pos, items]);

  const scheduleOpenSub = (index: number, target: HTMLElement) => {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      setOpenSub({ index, rect: target.getBoundingClientRect() });
    }, SUBMENU_DELAY_MS);
  };
  const cancelOpenSub = () => {
    if (hoverTimer.current != null) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null; }
  };

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }} />
      <div
        ref={ref}
        role="menu"
        className="fixed z-[61] min-w-[200px] py-1.5 border border-white/[0.08] rounded-md shadow-2xl animate-pop-in origin-top-left"
        style={{ left: resolvedPos.x, top: resolvedPos.y, minWidth: MIN_W, backgroundColor: '#28282d' }}
      >
        {items.map((entry, i) => {
          if (entry.type === 'separator') {
            return <div key={i} className="my-1 mx-2 border-t border-white/[0.06]" />;
          }
          const hasSub = !!entry.submenu && entry.submenu.length > 0;
          return (
            <button
              key={i}
              role="menuitem"
              disabled={entry.disabled}
              title={entry.disabled ? entry.title : undefined}
              onMouseEnter={(e) => hasSub && !entry.disabled ? scheduleOpenSub(i, e.currentTarget) : (cancelOpenSub(), setOpenSub(null))}
              onMouseLeave={cancelOpenSub}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (hasSub) return; // hovering opens submenu; click is no-op
                entry.onClick?.();
                closeContextMenu();
              }}
              className={`w-full flex items-center justify-between gap-3 px-2.5 py-1.5 text-[13px] text-left transition-colors mx-1 rounded
                ${entry.disabled
                  ? 'text-fg-dim cursor-not-allowed'
                  : entry.danger
                    ? 'text-danger hover:bg-danger hover:text-white'
                    : 'text-fg hover:bg-accent hover:text-white'}`}
              style={{ width: 'calc(100% - 8px)' }}
            >
              <span className="truncate">{entry.label}</span>
              <span className="shrink-0 flex items-center gap-1">
                {entry.icon && <span className="opacity-80">{entry.icon}</span>}
                {hasSub && <span aria-hidden className="text-fg-dim">▸</span>}
              </span>
            </button>
          );
        })}
      </div>
      {openSub && (() => {
        const entry = items[openSub.index];
        if (!entry || entry.type !== 'item' || !entry.submenu) return null;
        // Position to the right of the parent item, falling back to the left.
        const x = openSub.rect.right + 2;
        const y = openSub.rect.top;
        return createPortal(<Submenu items={entry.submenu} pos={{ x, y }} fallbackLeft={openSub.rect.left} />, document.body);
      })()}
    </>
  );
}

function Submenu({ items, pos, fallbackLeft }: { items: ContextMenuEntry[]; pos: Position; fallbackLeft: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [resolvedPos, setResolvedPos] = useState<Position>(pos);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let { x, y } = pos;
    if (x + rect.width + margin > window.innerWidth) x = Math.max(margin, fallbackLeft - rect.width - 2);
    if (y + rect.height + margin > window.innerHeight) y = Math.max(margin, window.innerHeight - rect.height - margin);
    setResolvedPos({ x, y });
  }, [pos, items, fallbackLeft]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[62] min-w-[200px] py-1.5 border border-white/[0.08] rounded-md shadow-2xl animate-pop-in origin-top-left max-h-[60vh] overflow-y-auto"
      style={{ left: resolvedPos.x, top: resolvedPos.y, minWidth: MIN_W, backgroundColor: '#28282d' }}
    >
      {items.map((entry, i) => {
        if (entry.type === 'separator') return <div key={i} className="my-1 mx-2 border-t border-white/[0.06]" />;
        return (
          <button
            key={i}
            role="menuitem"
            disabled={entry.disabled}
            title={entry.disabled ? entry.title : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { entry.onClick?.(); closeContextMenu(); }}
            className={`w-full flex items-center justify-between gap-3 px-2.5 py-1.5 text-[13px] text-left transition-colors mx-1 rounded
              ${entry.disabled
                ? 'text-fg-dim cursor-not-allowed'
                : entry.danger
                  ? 'text-danger hover:bg-danger hover:text-white'
                  : 'text-fg hover:bg-accent hover:text-white'}`}
            style={{ width: 'calc(100% - 8px)' }}
          >
            <span className="truncate flex items-center gap-2">{entry.icon && <span className="opacity-80">{entry.icon}</span>}{entry.label}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck and existing menu still works**

Run: `npm run typecheck`
Expected: PASS. Existing call sites compile because `onClick` is now optional and previously-required `onClick` was already provided.

- [ ] **Step 3: Run dev and smoke-test existing message context menu**

Run: `npm run dev` in a terminal. In the running app, right-click a message — verify the existing menu still opens, items click correctly, and Escape dismisses. Close dev when done.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ContextMenu.tsx
git commit -m "feat(context-menu): add submenu support and disabled tooltip"
```

---

## Task 9: ConfirmDialog + moderation dialogs

**Files:**
- Create: `src/renderer/components/ConfirmDialog.tsx`
- Create: `src/renderer/components/moderation/KickDialog.tsx`
- Create: `src/renderer/components/moderation/BanDialog.tsx`
- Create: `src/renderer/components/moderation/TimeoutDialog.tsx`

- [ ] **Step 1: Create `ConfirmDialog.tsx`**

```tsx
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onMouseDown={onCancel}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className="w-[440px] max-w-[90vw] rounded-md border border-white/[0.08] shadow-2xl"
        style={{ backgroundColor: '#28282d' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-2 text-fg text-[16px] font-semibold">{title}</div>
        {description && <div className="px-5 pb-2 text-fg-dim text-[13px]">{description}</div>}
        <div className="px-5 py-3 space-y-3">{children}</div>
        <div className="px-5 py-3 flex justify-end gap-2 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-1.5 rounded text-[13px] text-fg hover:bg-hover disabled:opacity-50"
          >Cancel</button>
          <button
            type="button"
            data-autofocus
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-1.5 rounded text-[13px] text-white disabled:opacity-50 ${danger ? 'bg-danger hover:bg-danger/80' : 'bg-accent hover:bg-accent/80'}`}
          >{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Create `KickDialog.tsx`**

```tsx
import { useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { api } from '../../lib/api';
import { pushToast } from '../Toaster';

export function KickDialog({
  guildId, userId, displayName, onClose,
}: { guildId: string; userId: string; displayName: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await api.guilds.kickMember(guildId, userId, reason.trim() || undefined);
    setBusy(false);
    if (res.ok) {
      pushToast('ok', `Kicked ${displayName}`);
      onClose();
    } else {
      pushToast('danger', res.error.message);
    }
  };

  return (
    <ConfirmDialog
      title={`Kick ${displayName}?`}
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

- [ ] **Step 3: Create `BanDialog.tsx`**

```tsx
import { useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { api } from '../../lib/api';
import { pushToast } from '../Toaster';

const HISTORY_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: "Don't delete any", seconds: 0 },
  { label: 'Last hour', seconds: 60 * 60 },
  { label: 'Last 6 hours', seconds: 6 * 60 * 60 },
  { label: 'Last 12 hours', seconds: 12 * 60 * 60 },
  { label: 'Last 24 hours', seconds: 24 * 60 * 60 },
  { label: 'Last 3 days', seconds: 3 * 24 * 60 * 60 },
  { label: 'Last 7 days', seconds: 7 * 24 * 60 * 60 },
];

export function BanDialog({
  guildId, userId, displayName, onClose,
}: { guildId: string; userId: string; displayName: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [historySeconds, setHistorySeconds] = useState(0);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await api.guilds.banMember(guildId, userId, {
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      deleteMessageSeconds: historySeconds,
    });
    setBusy(false);
    if (res.ok) {
      pushToast('ok', `Banned ${displayName}`);
      onClose();
    } else {
      pushToast('danger', res.error.message);
    }
  };

  return (
    <ConfirmDialog
      title={`Ban ${displayName}?`}
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

- [ ] **Step 4: Create `TimeoutDialog.tsx`**

```tsx
import { useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { api } from '../../lib/api';
import { pushToast } from '../Toaster';

const PRESETS: Array<{ label: string; ms: number }> = [
  { label: '1 minute',  ms: 60_000 },
  { label: '5 minutes', ms: 5 * 60_000 },
  { label: '10 minutes', ms: 10 * 60_000 },
  { label: '1 hour',    ms: 60 * 60_000 },
  { label: '1 day',     ms: 24 * 60 * 60_000 },
  { label: '1 week',    ms: 7 * 24 * 60 * 60_000 },
];

const UNIT_MS: Record<string, number> = {
  minutes: 60_000,
  hours:   60 * 60_000,
  days:    24 * 60 * 60_000,
};

export function TimeoutDialog({
  guildId, userId, displayName, onClose,
}: { guildId: string; userId: string; displayName: string; onClose: () => void }) {
  const [presetMs, setPresetMs] = useState<number>(PRESETS[2]!.ms); // 10 min default
  const [customN, setCustomN] = useState<string>('');
  const [customUnit, setCustomUnit] = useState<keyof typeof UNIT_MS>('minutes');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const customMs = (() => {
    const n = Number(customN);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n * UNIT_MS[customUnit]!);
  })();
  const effectiveMs = customMs > 0 ? customMs : presetMs;
  const tooLong = effectiveMs > 28 * 24 * 60 * 60_000;

  const submit = async () => {
    if (effectiveMs <= 0 || tooLong) return;
    setBusy(true);
    const res = await api.guilds.timeoutMember(guildId, userId, effectiveMs, reason.trim() || undefined);
    setBusy(false);
    if (res.ok) {
      pushToast('ok', `Timed out ${displayName}`);
      onClose();
    } else {
      pushToast('danger', res.error.message);
    }
  };

  return (
    <ConfirmDialog
      title={`Timeout ${displayName}?`}
      description="They won't be able to send messages or react until the timeout expires."
      confirmLabel="Timeout"
      busy={busy}
      onCancel={onClose}
      onConfirm={submit}
    >
      <label className="block text-[12px] text-fg-dim mb-1">Duration</label>
      <select
        value={customMs > 0 ? '' : String(presetMs)}
        onChange={(e) => { if (e.target.value) { setPresetMs(Number(e.target.value)); setCustomN(''); } }}
        className="w-full px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
      >
        {PRESETS.map(p => <option key={p.ms} value={p.ms}>{p.label}</option>)}
        <option value="">Custom…</option>
      </select>
      <div className="flex gap-2 mt-2">
        <input
          type="number"
          min={0}
          value={customN}
          onChange={(e) => setCustomN(e.target.value)}
          placeholder="0"
          className="flex-1 px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
        />
        <select
          value={customUnit}
          onChange={(e) => setCustomUnit(e.target.value as keyof typeof UNIT_MS)}
          className="px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
        >
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
      </div>
      {tooLong && <div className="text-[12px] text-danger mt-1">Maximum timeout is 28 days.</div>}
      <label className="block text-[12px] text-fg-dim mb-1 mt-3">Reason (optional, shown in audit log)</label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 512))}
        maxLength={512}
        className="w-full px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
        placeholder="Why are you timing them out?"
      />
    </ConfirmDialog>
  );
}
```

- [ ] **Step 5: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/ConfirmDialog.tsx src/renderer/components/moderation
git commit -m "feat(moderation): add ConfirmDialog + Kick/Ban/Timeout dialogs"
```

---

## Task 10: `buildUserMenu` factory + role submenu

**Files:**
- Create: `src/renderer/components/UserContextMenu.ts`

- [ ] **Step 1: Create the factory**

This factory returns the menu and signals desired side-effects via callbacks. It does NOT fetch data — callers pass in roles + capabilities + member info, and supply callbacks for the moderation dialogs and the mention/copy actions.

```ts
import type { ContextMenuEntry } from './ContextMenu';
import type { BotCapabilities, GuildRole } from '../../shared/domain';

export type UserMenuTarget = {
  guildId: string;
  userId: string;
  username: string;
  displayName: string;
  // Role IDs currently assigned to this user (excluding @everyone).
  assignedRoleIds: Set<string>;
};

export type UserMenuCallbacks = {
  onOpenProfile: () => void;
  onMention: () => void;
  onCopyUsername: () => void;
  onCopyUserId: () => void;
  onOpenKick: () => void;
  onOpenBan: () => void;
  onOpenTimeout: () => void;
  // Role toggle: returns nothing — fires IPC and updates UI optimistically.
  onToggleRole: (roleId: string, currentlyAssigned: boolean) => void;
};

export function buildUserMenu({
  target, capabilities, roles, callbacks,
}: {
  target: UserMenuTarget;
  capabilities: BotCapabilities | null; // null while loading — items render disabled
  roles: GuildRole[] | null;            // null until first hover; passed when available
  callbacks: UserMenuCallbacks;
}): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = [];

  items.push({ type: 'item', label: 'Profile', onClick: callbacks.onOpenProfile });
  items.push({ type: 'separator' });

  // Roles submenu
  if (!capabilities?.targetIsSelf) {
    const rolesDisabled = !capabilities?.canManageRoles;
    let title: string | undefined;
    if (capabilities && !capabilities.canManageRoles) {
      title = capabilities.outranksTarget
        ? 'Bot is missing the Manage Roles permission'
        : "@user's highest role is at or above the bot's highest role";
    }
    items.push({
      type: 'item',
      label: 'Roles',
      disabled: rolesDisabled,
      ...(title ? { title } : {}),
      submenu: buildRoleSubmenu({ target, roles, capabilities, onToggleRole: callbacks.onToggleRole }),
    });
    items.push({ type: 'separator' });
  }

  // Moderation actions — hidden when target is the bot itself.
  if (!capabilities?.targetIsSelf) {
    items.push(modItem('Timeout…', capabilities?.canTimeout ?? false, capabilities, 'Timeout Members', callbacks.onOpenTimeout));
    items.push(modItem('Kick…',    capabilities?.canKick ?? false,    capabilities, 'Kick Members',    callbacks.onOpenKick));
    items.push(modItem('Ban…',     capabilities?.canBan ?? false,     capabilities, 'Ban Members',     callbacks.onOpenBan));
    items.push({ type: 'separator' });
  }

  items.push({ type: 'item', label: 'Mention',       onClick: callbacks.onMention });
  items.push({ type: 'item', label: 'Copy Username', onClick: callbacks.onCopyUsername });
  items.push({ type: 'item', label: 'Copy User ID',  onClick: callbacks.onCopyUserId });

  return items;
}

function modItem(
  label: string,
  enabled: boolean,
  caps: BotCapabilities | null,
  permName: string,
  onClick: () => void,
): ContextMenuEntry {
  let title: string | undefined;
  if (caps && !enabled) {
    if (caps.missingPermissions.includes(permName)) {
      title = `Bot is missing the ${permName} permission`;
    } else if (!caps.outranksTarget) {
      title = "Target's highest role is at or above the bot's highest role";
    }
  }
  return {
    type: 'item',
    label,
    danger: true,
    onClick,
    disabled: !enabled,
    ...(title ? { title } : {}),
  };
}

function buildRoleSubmenu({
  target, roles, capabilities, onToggleRole,
}: {
  target: UserMenuTarget;
  roles: GuildRole[] | null;
  capabilities: BotCapabilities | null;
  onToggleRole: (roleId: string, currentlyAssigned: boolean) => void;
}): ContextMenuEntry[] {
  if (!roles) return [{ type: 'item', label: 'Loading roles…', disabled: true }];
  const assignable = roles.filter(r => !r.managed);
  if (assignable.length === 0) return [{ type: 'item', label: 'No assignable roles', disabled: true }];

  const botTop = capabilities?.botTopRolePosition ?? Infinity;
  return assignable.map<ContextMenuEntry>(r => {
    const assigned = target.assignedRoleIds.has(r.id);
    const aboveBot = r.position >= botTop;
    const title = aboveBot ? "Role is at or above the bot's highest role" : undefined;
    return {
      type: 'item',
      label: `${assigned ? '✓ ' : '   '}${r.name}`,
      disabled: aboveBot,
      ...(title ? { title } : {}),
      icon: r.color
        ? <span /> // placeholder — see Step 2
        : undefined,
      onClick: () => onToggleRole(r.id, assigned),
    };
  });
}
```

- [ ] **Step 2: Convert file to TSX for the color-dot icon**

The file uses JSX (`<span />`), so rename and adjust:

Rename `src/renderer/components/UserContextMenu.ts` → `src/renderer/components/UserContextMenu.tsx`.

Replace the `icon` line in `buildRoleSubmenu` with:

```tsx
      icon: r.color
        ? <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
        : <span className="inline-block w-2.5 h-2.5 rounded-full bg-fg-dim/30" />,
```

And add at the top of the file:
```tsx
import * as React from 'react';
void React;
```

(Or just use `import type { ReactNode } from 'react';` — the JSX transform will handle the rest depending on tsconfig. If tsconfig uses `react-jsx`, no React import is needed. Verify with the existing renderer files; most use no React import.)

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/UserContextMenu.tsx
git commit -m "feat(context-menu): add buildUserMenu factory with roles submenu"
```

---

## Task 11: Wire user context menu into MemberList

**Files:**
- Modify: `src/renderer/components/MemberList.tsx`

- [ ] **Step 1: Add right-click handler and menu state**

Replace the contents of `src/renderer/components/MemberList.tsx` with the following — preserves all existing behavior, adds:
- A guild-roles cache (lazy-fetched on first menu open per guild)
- Right-click handler on `MemberRow`
- Capability fetch + menu wiring
- Moderation dialog state

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
import { UserProfileCard } from './UserProfileCard';
import { openContextMenu } from './ContextMenu';
import { buildUserMenu, type UserMenuTarget } from './UserContextMenu';
import { KickDialog } from './moderation/KickDialog';
import { BanDialog } from './moderation/BanDialog';
import { TimeoutDialog } from './moderation/TimeoutDialog';
import { pushToast } from './Toaster';
import type { ChannelMemberSummary, PresenceStatus, GuildRole, BotCapabilities, MemberDetail } from '../../shared/domain';

const STATUS_COLOR: Record<PresenceStatus, string> = {
  online: 'bg-ok',
  idle: 'bg-warn',
  dnd: 'bg-danger',
  offline: 'bg-fg-dim',
};

type ModState =
  | { kind: 'kick' | 'ban' | 'timeout'; userId: string; displayName: string }
  | null;

export function MemberList({ guildId, channelId }: { guildId: string | null; channelId: string | null }) {
  const [members, setMembers] = useState<ChannelMemberSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [profileState, setProfileState] = useState<{ userId: string; rect: DOMRect } | null>(null);
  const [modState, setModState] = useState<ModState>(null);
  const rolesCache = useRef<Map<string, GuildRole[]>>(new Map());

  useEffect(() => {
    if (!guildId || !channelId) { setMembers([]); return; }
    let active = true;
    setLoading(true);
    api.guilds.listChannelMembers(guildId, channelId).then(res => {
      if (!active) return;
      setLoading(false);
      if (res.ok) setMembers(res.data);
    });
    return () => { active = false; };
  }, [guildId, channelId]);

  // Reset cache when guild changes
  useEffect(() => { rolesCache.current = new Map(); }, [guildId]);

  const onContextMenuMember = async (e: React.MouseEvent, m: ChannelMemberSummary) => {
    if (!guildId) return;
    e.preventDefault();

    // Fetch capabilities + member detail (for assigned role IDs) in parallel.
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

    // Pre-populate roles if cached, otherwise null (submenu shows "Loading…"
    // until we backfill below).
    const rolesNow = rolesCache.current.get(guildId) ?? null;

    const reopen = (latestRoles: GuildRole[] | null, latestAssigned: Set<string>) => {
      const items = buildUserMenu({
        target: { ...target, assignedRoleIds: latestAssigned },
        capabilities,
        roles: latestRoles,
        callbacks: {
          onOpenProfile: () => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setProfileState({ userId: m.id, rect });
          },
          onMention:       () => { void api.system.copyText(`<@${m.id}>`); pushToast('ok', 'Mention copied'); },
          onCopyUsername:  () => { void api.system.copyText(m.username); pushToast('ok', 'Username copied'); },
          onCopyUserId:    () => { void api.system.copyText(m.id); pushToast('ok', 'ID copied'); },
          onOpenKick:      () => setModState({ kind: 'kick',    userId: m.id, displayName: m.displayName }),
          onOpenBan:       () => setModState({ kind: 'ban',     userId: m.id, displayName: m.displayName }),
          onOpenTimeout:   () => setModState({ kind: 'timeout', userId: m.id, displayName: m.displayName }),
          onToggleRole: async (roleId, currentlyAssigned) => {
            // Optimistic local update so the next-open menu shows the new state.
            const next = new Set(latestAssigned);
            if (currentlyAssigned) next.delete(roleId); else next.add(roleId);
            const res = currentlyAssigned
              ? await api.guilds.removeRole(guildId, m.id, roleId)
              : await api.guilds.assignRole(guildId, m.id, roleId);
            if (!res.ok) pushToast('danger', res.error.message);
            // (We do not need to refresh the visible member list — role color/
            // hoist updates flow in via gateway events handled elsewhere.)
          },
        },
      });
      openContextMenu(e as unknown as { preventDefault: () => void; clientX: number; clientY: number }, items);
    };

    reopen(rolesNow, target.assignedRoleIds);

    // Backfill roles cache in the background. We do not re-open the menu — the
    // next right-click will see the cached roles. This keeps UX simple while
    // staying responsive on first right-click.
    if (!rolesNow) {
      api.guilds.listGuildRoles(guildId).then(res => {
        if (res.ok) rolesCache.current.set(guildId, res.data);
      });
    }
  };

  const groups = useMemo(() => {
    type Group = {
      id: string;
      name: string;
      position: number;
      color: string | null;
      iconUrl: string | null;
      unicodeEmoji: string | null;
      members: ChannelMemberSummary[];
    };
    const byRole = new Map<string, Group>();
    const offline: ChannelMemberSummary[] = [];
    const onlineNoRole: ChannelMemberSummary[] = [];

    for (const m of members) {
      if (m.status === 'offline') { offline.push(m); continue; }
      if (!m.topRole) { onlineNoRole.push(m); continue; }
      const key = m.topRole.id;
      let g = byRole.get(key);
      if (!g) {
        g = {
          id: m.topRole.id,
          name: m.topRole.name,
          position: m.topRole.position,
          color: m.topRole.color,
          iconUrl: m.topRole.iconUrl,
          unicodeEmoji: m.topRole.unicodeEmoji,
          members: [],
        };
        byRole.set(key, g);
      }
      g.members.push(m);
    }

    const sorted = Array.from(byRole.values())
      .sort((a, b) => b.position - a.position)
      .map(g => ({ ...g, members: g.members.sort((a, b) => a.displayName.localeCompare(b.displayName)) }));

    onlineNoRole.sort((a, b) => a.displayName.localeCompare(b.displayName));
    offline.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return { sorted, onlineNoRole, offline };
  }, [members]);

  return (
    <aside className="w-[270px] shrink-0 bg-bg border-t border-l border-white/[0.04] overflow-y-auto py-4">
      {loading && members.length === 0 && (
        <div className="px-4 text-fg-dim text-xs">Loading…</div>
      )}
      {groups.sorted.map(g => (
        <Section
          key={g.id}
          title={`${g.name} — ${g.members.length}`}
          iconUrl={g.iconUrl}
          unicodeEmoji={g.unicodeEmoji}
          roleName={g.name}
          members={g.members}
          onClickMember={(userId, rect) => setProfileState({ userId, rect })}
          onContextMenuMember={onContextMenuMember}
        />
      ))}
      {groups.onlineNoRole.length > 0 && (
        <Section
          title={`Online — ${groups.onlineNoRole.length}`}
          members={groups.onlineNoRole}
          onClickMember={(userId, rect) => setProfileState({ userId, rect })}
          onContextMenuMember={onContextMenuMember}
        />
      )}
      {groups.offline.length > 0 && (
        <Section
          title={`Offline — ${groups.offline.length}`}
          members={groups.offline}
          onClickMember={(userId, rect) => setProfileState({ userId, rect })}
          onContextMenuMember={onContextMenuMember}
        />
      )}
      {profileState && guildId && (
        <UserProfileCard
          guildId={guildId}
          userId={profileState.userId}
          anchorRect={profileState.rect}
          onClose={() => setProfileState(null)}
        />
      )}
      {modState && guildId && modState.kind === 'kick'    && <KickDialog    guildId={guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
      {modState && guildId && modState.kind === 'ban'     && <BanDialog     guildId={guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
      {modState && guildId && modState.kind === 'timeout' && <TimeoutDialog guildId={guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
    </aside>
  );
}

function Section({
  title, members, iconUrl, unicodeEmoji, roleName, onClickMember, onContextMenuMember,
}: {
  title: string;
  members: ChannelMemberSummary[];
  iconUrl?: string | null;
  unicodeEmoji?: string | null;
  roleName?: string;
  onClickMember: (userId: string, rect: DOMRect) => void;
  onContextMenuMember: (e: React.MouseEvent, m: ChannelMemberSummary) => void;
}) {
  return (
    <div className="mb-4">
      <div className="px-4 mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-dim">
        {iconUrl
          ? <img src={iconUrl} alt={roleName ?? ''} title={roleName} className="w-4 h-4 object-contain" />
          : unicodeEmoji
            ? <span title={roleName} className="text-[14px] leading-none">{unicodeEmoji}</span>
            : null}
        <span>{title}</span>
      </div>
      <div>
        {members.map(m => (
          <MemberRow
            key={m.id}
            member={m}
            onClickMember={onClickMember}
            onContextMenu={(e) => onContextMenuMember(e, m)}
          />
        ))}
      </div>
    </div>
  );
}

function MemberRow({
  member, onClickMember, onContextMenu,
}: {
  member: ChannelMemberSummary;
  onClickMember: (userId: string, rect: DOMRect) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const dim = member.status === 'offline';
  return (
    <div
      className={`flex items-center gap-2 px-2 mx-2 py-1 rounded hover:bg-hover cursor-pointer ${dim ? 'opacity-40' : ''}`}
      title={`@${member.username}${member.topRole ? ` · ${member.topRole.name}` : ''}`}
      onClick={(e) => onClickMember(member.id, (e.currentTarget as HTMLElement).getBoundingClientRect())}
      onContextMenu={onContextMenu}
    >
      <div className="relative shrink-0">
        <Avatar
          src={member.avatarUrl}
          alt=""
          className="w-8 h-8 rounded-full"
          fallback={<div className="w-8 h-8 rounded-full bg-bg-input flex items-center justify-center text-[10px] font-semibold">{member.displayName.slice(0, 2).toUpperCase()}</div>}
        />
        {member.status === 'idle' ? (
          <svg aria-hidden className="absolute -bottom-[3px] -right-[3px] w-[14px] h-[14px]" viewBox="0 0 14 14">
            <circle cx="7" cy="7" r="7" className="fill-bg" />
            <mask id="idle-mask">
              <rect width="14" height="14" fill="white" />
              <circle cx="5" cy="4.5" r="3.5" fill="black" />
            </mask>
            <circle cx="7" cy="7" r="5" className="fill-warn" mask="url(#idle-mask)" />
          </svg>
        ) : (
          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${STATUS_COLOR[member.status]} ring-2 ring-bg`} />
        )}
      </div>
      <span
        className="text-[14px] truncate min-w-0 flex-1"
        style={member.roleColor ? { color: member.roleColor } : undefined}
      >
        {member.displayName}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/MemberList.tsx
git commit -m "feat(member-list): wire user right-click menu in sidebar"
```

---

## Task 12: Wire user context menu into MessageGroup author

**Files:**
- Modify: `src/renderer/components/MessageGroup.tsx:130-200`

- [ ] **Step 1: Read the current MessageGroup file fully to identify imports and existing onContextMenu**

Run: read `src/renderer/components/MessageGroup.tsx` end-to-end to ensure the changes below don't conflict.

- [ ] **Step 2: Add author-targeted right-click handler**

Inside the `MessageGroup` component (near the existing `openProfile` definition around line 144), add helpers and state mirroring `MemberList`:

```tsx
import { KickDialog } from './moderation/KickDialog';
import { BanDialog } from './moderation/BanDialog';
import { TimeoutDialog } from './moderation/TimeoutDialog';
import { buildUserMenu, type UserMenuTarget } from './UserContextMenu';
import type { GuildRole, BotCapabilities, MemberDetail } from '../../shared/domain';
```

Add inside the component, alongside other `useState` calls:

```tsx
  const [modState, setModState] = useState<{ kind: 'kick' | 'ban' | 'timeout'; userId: string; displayName: string } | null>(null);
  const rolesCacheRef = useRef<Map<string, GuildRole[]>>(new Map());
```

(Ensure `useRef` is imported at the top: `import { useRef, useState } from 'react';`.)

Add a handler:

```tsx
  const onAuthorContextMenu = async (e: React.MouseEvent, authorId: string, displayName: string, username: string) => {
    if (!head.guildId) return;
    e.preventDefault();
    e.stopPropagation(); // suppress the message-body context menu

    const guildId = head.guildId;
    const [capRes, memRes] = await Promise.all([
      api.guilds.getBotCapabilities(guildId, authorId),
      api.guilds.getMember(guildId, authorId),
    ]);
    const capabilities: BotCapabilities | null = capRes.ok ? capRes.data : null;
    const detail: MemberDetail | null = memRes.ok ? memRes.data : null;
    if (!capabilities) { pushToast('danger', capRes.ok ? 'Failed to load capabilities' : capRes.error.message); return; }

    const target: UserMenuTarget = {
      guildId,
      userId: authorId,
      username,
      displayName,
      assignedRoleIds: new Set(detail?.roles.map(r => r.id) ?? []),
    };
    const rolesNow = rolesCacheRef.current.get(guildId) ?? null;

    const items = buildUserMenu({
      target,
      capabilities,
      roles: rolesNow,
      callbacks: {
        onOpenProfile:  () => setProfileState({ userId: authorId, guildId, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() }),
        onMention:      () => { void api.system.copyText(`<@${authorId}>`); pushToast('ok', 'Mention copied'); },
        onCopyUsername: () => { void api.system.copyText(username); pushToast('ok', 'Username copied'); },
        onCopyUserId:   () => { void api.system.copyText(authorId); pushToast('ok', 'ID copied'); },
        onOpenKick:     () => setModState({ kind: 'kick',    userId: authorId, displayName }),
        onOpenBan:      () => setModState({ kind: 'ban',     userId: authorId, displayName }),
        onOpenTimeout:  () => setModState({ kind: 'timeout', userId: authorId, displayName }),
        onToggleRole: async (roleId, currentlyAssigned) => {
          const res = currentlyAssigned
            ? await api.guilds.removeRole(guildId, authorId, roleId)
            : await api.guilds.assignRole(guildId, authorId, roleId);
          if (!res.ok) pushToast('danger', res.error.message);
        },
      },
    });
    openContextMenu(e as unknown as { preventDefault: () => void; clientX: number; clientY: number }, items);

    if (!rolesNow) {
      api.guilds.listGuildRoles(guildId).then(res => {
        if (res.ok) rolesCacheRef.current.set(guildId, res.data);
      });
    }
  };
```

- [ ] **Step 3: Attach the handler to author avatar and name span**

Locate the avatar wrapper at line 187 — `<div className="w-10 shrink-0 pt-0.5 cursor-pointer" onClick={(e) => openProfile(e, head.authorId)}>` — and add `onContextMenu={(e) => onAuthorContextMenu(e, head.authorId, head.authorDisplayName, head.authorTag)}`.

Locate the author name span at line 198-203 (`<span className="font-medium text-[15px] truncate cursor-pointer hover:underline" ... onClick={(e) => openProfile(e, head.authorId)}>...`) and add the same `onContextMenu` handler.

(`head.authorTag` is the username — verify by checking the `MessageSummary` type. If the field is named differently, adjust.)

- [ ] **Step 4: Render moderation dialogs at the bottom of the component**

Just before the closing `</div>` of the component's root JSX, add:

```tsx
      {modState && head.guildId && modState.kind === 'kick'    && <KickDialog    guildId={head.guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
      {modState && head.guildId && modState.kind === 'ban'     && <BanDialog     guildId={head.guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
      {modState && head.guildId && modState.kind === 'timeout' && <TimeoutDialog guildId={head.guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
```

- [ ] **Step 5: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS. If `head.authorTag` doesn't exist, locate the actual username field on `MessageSummary` (search `src/shared/domain.ts` for `authorTag` or `authorUsername`) and use that instead.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/MessageGroup.tsx
git commit -m "feat(message-group): wire user right-click menu on author avatar/name"
```

---

## Task 13: Manual smoke test

This task has no commits — it's the verification gate before declaring the feature done.

- [ ] **Step 1: Run dev**

Run: `npm run dev`

- [ ] **Step 2: Right-click in member list (sidebar)**

Test cases:
- Right-click a normal member: menu opens with Profile / Roles / Timeout / Kick / Ban / Mention / Copy Username / Copy User ID
- Hover "Roles": submenu opens. Roles above the bot's top role are disabled with a tooltip on hover
- Click an unassigned role: it gets assigned (verify in target user's Discord profile after a moment)
- Click an assigned role: it gets removed
- Click "Copy User ID": toast confirms; pasting elsewhere yields the snowflake
- Click "Mention": pasting elsewhere yields `<@id>`

- [ ] **Step 3: Right-click on a message author**

- Right-click the author's avatar: user menu opens (NOT the message menu)
- Right-click the message body: existing message menu opens
- Right-click the author's name: user menu opens

- [ ] **Step 4: Moderation dialogs**

- Click "Kick…" on a test account: dialog opens, type reason, confirm; account is kicked, audit log shows reason
- Click "Ban…" with delete history "Last hour": dialog opens, confirm; account banned, recent messages purged
- Click "Timeout…" with custom duration 2 minutes: dialog opens, confirm; user is timed out for ~2 min

- [ ] **Step 5: Permission/hierarchy disabled states**

- Temporarily remove ManageRoles from the bot's role: re-open the menu — "Roles" item is disabled with tooltip "Bot is missing the Manage Roles permission"
- Right-click a server admin (whose top role outranks the bot): all four moderation/role items disabled with hierarchy tooltip
- Right-click the bot itself: moderation and role items hidden entirely

- [ ] **Step 6: Run full test suite + typecheck + lint**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all PASS.

- [ ] **Step 7: Final commit (if any cleanup needed) — otherwise done**

If smoke testing surfaced any issues, fix them and commit. Otherwise the previous commits stand.

---

## Self-Review Notes

- **Spec coverage:** All sections of the design spec map to tasks — types/IPC (Task 1), permissions update (Task 2), capability helper (Task 3), 7 IPC handlers (Tasks 4-6), preload (Task 7), submenu support (Task 8), dialogs (Task 9), menu factory (Task 10), wiring (Tasks 11-12), manual testing (Task 13).
- **Type consistency:** `BotCapabilities`, `GuildRole`, `UserMenuTarget`, `UserMenuCallbacks` defined in Task 1/Task 10 and referenced consistently. IPC channel names match across `IPC_CHANNELS`, handlers, and preload bindings.
- **Out of scope reaffirmed:** No mention chip wiring, no role search input, no bulk operations.
- **Known soft spot:** `MessageSummary.authorTag` may not be the exact field name on the username — Task 12 includes a "verify" step. Worst case: replace with `head.authorDisplayName` or whichever string field carries the bare username.
