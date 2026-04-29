# User Context Menu with Role Management — Design

**Date:** 2026-04-29
**Status:** Approved (brainstorming)

## Goal

Add a dedicated right-click context menu for users (members) in BotCord. The menu's headline feature is role management — assign/remove roles via the bot — alongside moderation actions (kick, ban, timeout) and convenience items (mention, copy username, copy ID). All actions respect Discord's permission and role-hierarchy rules; unavailable actions are shown disabled with a tooltip explaining why.

## Non-Goals (deferred)

- Right-click on `@mention` chips inside message content
- Search/filter input inside the role submenu
- Bulk role operations
- Audit log viewer or moderation history UI

## Architecture

A reusable `buildUserMenu()` factory produces `ContextMenuEntry[]` for a given member + capability snapshot, and is wired to right-click handlers on:

- `MemberRow` in the sidebar (`MemberList.tsx`)
- The author avatar/name in `MessageGroup.tsx` (existing message-body context menu is preserved)

The shared `ContextMenu` component gains submenu support (one optional property: `submenu?: ContextMenuEntry[]`). Submenus open on hover with a small delay, render to the side of the parent item with viewport clamping, and inherit the parent's styling.

A new generic `ConfirmDialog` component backs all three moderation flows. It is a centered modal with focus trap and Esc-to-cancel. Three thin wrappers (`TimeoutDialog`, `KickDialog`, `BanDialog`) supply the dialog with the action-specific fields.

## Menu Structure

```
Profile                          (opens existing UserProfileCard)
─────────────────────────
Roles                       ▸    (submenu — see below)
─────────────────────────
Timeout…                         (opens TimeoutDialog)
Kick…                            (opens KickDialog)
Ban…                             (opens BanDialog)
─────────────────────────
Mention                          (inserts @user mention into active composer)
Copy Username
Copy User ID
```

Disabled items render with reduced opacity and a `title` tooltip explaining the cause:

- `"Bot is missing the Manage Roles permission"`
- `"@user's highest role is above the bot's highest role"`
- `"Bot is missing the Kick Members permission"`
- etc.

When the target is the bot itself, moderation and role items are hidden entirely (not just disabled), since they are meaningless.

## Role Submenu

- Roles fetched lazily on first hover via `guilds.listGuildRoles`, cached per-guild for the session
- `@everyone` and `managed` (integration/bot-owned) roles excluded
- Each row: small color dot + role name + checkmark if currently assigned
- Roles whose position ≥ bot's top-role position are shown disabled with a hierarchy tooltip
- The whole submenu is disabled if the bot lacks `ManageRoles` or the target outranks the bot
- Click toggles assignment: optimistic update of any open `UserProfileCard`, IPC fires, toast on failure with rollback
- Long lists scroll within a `max-height` box; no search input in v1

## Moderation Dialogs

All three dialogs share `ConfirmDialog` (modal, focus-trapped, Esc cancels, click-outside cancels). Confirm buttons are red. On success: dialog closes, toast confirms. On failure: toast with the discord.js error message; dialog stays open for retry.

**TimeoutDialog**
- Duration picker: presets [60s, 5m, 10m, 1h, 1d, 1w] + custom (number + unit selector)
- Reason: optional, max 512 characters (Discord audit-log limit)
- Confirm label: "Timeout"

**KickDialog**
- Reason: optional, max 512 characters
- Confirm label: "Kick"

**BanDialog**
- Reason: optional, max 512 characters
- Delete message history: dropdown [Don't delete, Last hour, Last 6 hours, Last 12 hours, Last 24 hours, Last 3 days, Last 7 days] → maps to `deleteMessageSeconds`
- Confirm label: "Ban"

## IPC Contract

New handlers in `src/main/ipc/guilds.ts`, registered in `src/shared/ipc-contract.ts`:

| Channel | Args | Returns |
|---|---|---|
| `guilds.listGuildRoles` | `guildId` | `GuildRole[]` |
| `guilds.getBotCapabilities` | `guildId, targetUserId` | `BotCapabilities` |
| `guilds.assignRole` | `guildId, userId, roleId` | `void` |
| `guilds.removeRole` | `guildId, userId, roleId` | `void` |
| `guilds.kickMember` | `guildId, userId, reason?` | `void` |
| `guilds.banMember` | `guildId, userId, reason?, deleteMessageSeconds?` | `void` |
| `guilds.timeoutMember` | `guildId, userId, durationMs, reason?` | `void` |

`getBotCapabilities` is the single source of truth for menu enable/disable state. It returns:

```ts
type BotCapabilities = {
  canManageRoles: boolean;       // bot has ManageRoles AND outranks target
  canKick: boolean;              // bot has KickMembers AND outranks target
  canBan: boolean;               // bot has BanMembers AND outranks target
  canTimeout: boolean;           // bot has ModerateMembers AND outranks target
  missingPermissions: string[];  // human-readable names of missing flags
  outranksTarget: boolean;
  botTopRolePosition: number;
  targetTopRolePosition: number;
};
```

This avoids spreading hierarchy logic across the renderer and keeps a single round-trip on menu open.

## Permissions

`PermissionFlagsBits.ManageRoles | KickMembers | BanMembers | ModerateMembers` are added to `REQUIRED_PERMISSIONS` in `src/main/discord/permissions.ts`. The OAuth invite URL therefore requests these going forward. Existing installs whose bots lack the new perms keep working — `getBotCapabilities` simply reports them as missing and the menu items render disabled with explanatory tooltips.

A new helper `assertCanManageRole(botMember, targetMember, role)` lives alongside `permissions.ts` and is shared by `assignRole`/`removeRole` to defensively re-check on the main process side (renderer state can be stale).

## Data Flow

1. User right-clicks a member → handler calls `getBotCapabilities(guildId, userId)` and opens `ContextMenu` with `buildUserMenu(member, capabilities)`.
2. Hovering "Roles" triggers `listGuildRoles(guildId)` (cached after first call).
3. Clicking a role calls `assignRole`/`removeRole`; failure shows a toast and rolls back any optimistic UI change.
4. Clicking a moderation item opens the corresponding dialog. Submit calls the IPC; success closes the dialog and toasts; failure keeps the dialog open with the error.
5. Convenience items (Mention, Copy Username, Copy User ID) act locally without IPC.

## Files Changed

- `src/renderer/components/ContextMenu.tsx` — submenu support
- `src/renderer/components/UserContextMenu.ts` *(new)* — `buildUserMenu()` factory
- `src/renderer/components/MemberList.tsx` — wire `onContextMenu` on `MemberRow`
- `src/renderer/components/MessageGroup.tsx` — wire `onContextMenu` on author avatar/name only (preserve existing message menu on body)
- `src/renderer/components/ConfirmDialog.tsx` *(new)* — generic modal shell
- `src/renderer/components/moderation/TimeoutDialog.tsx` *(new)*
- `src/renderer/components/moderation/KickDialog.tsx` *(new)*
- `src/renderer/components/moderation/BanDialog.tsx` *(new)*
- `src/main/ipc/guilds.ts` — 7 new handlers
- `src/main/discord/permissions.ts` — add 4 permission flags; add `assertCanManageRole` and capability helpers
- `src/shared/ipc-contract.ts` — type definitions for new channels
- `src/shared/domain.ts` — `GuildRole`, `BotCapabilities` types

## Error Handling

- All IPC handlers wrap discord.js calls in try/catch and return a structured error to the renderer (`{ ok: false, message }`)
- Renderer surfaces errors via existing toast system; the menu/dialog never crashes the app
- Hierarchy and permission checks happen on **both** sides: renderer disables UI, main process re-validates before calling Discord (defense in depth)

## Testing

- Manual: smoke test against a real test guild with three bot configurations — full perms, missing ManageRoles, missing all moderation perms — verifying menu states match expectations
- Manual: target users at three hierarchy positions — below bot, equal to bot, above bot
- Manual: role submenu with a guild that has 30+ roles to verify scroll behavior
- Existing typecheck/lint must pass
