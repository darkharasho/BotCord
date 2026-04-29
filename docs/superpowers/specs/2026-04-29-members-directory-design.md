# Members Directory — Design

**Date:** 2026-04-29
**Status:** Approved (brainstorming)

## Goal

Add a "Members" pseudo-channel entry above the channel list. Selecting it replaces the chat pane (message list, composer, member sidebar) with a full-width members directory: a virtualized table of every guild member with search, sort, role filter, multi-select, and bulk actions (role add/remove, kick, ban).

## Non-Goals (deferred)

- Join-method tracking (would require persistent invite-event listening)
- Discord-style "Signals" (not exposed to bots)
- Bulk timeout
- Activity / last-seen data
- CSV export
- Pagination — we virtualize instead

## Architecture

A new `view: 'channel' | 'members'` discriminator in `ShellRoute` controls the main pane. When `members` is selected, `ShellRoute` renders `<MembersDirectory>` instead of `<ChannelView>` / `<ForumView>`. The existing `lastChannelByGuild` map is generalized to `lastViewByGuild`, preserving the last view (channel id or `members`) per guild.

`ChannelList` renders a sticky "Members" row above the channels. It styles like a channel row (icon + label + count) and is selected/highlighted when active.

`MembersDirectory` fetches the full member list once per guild via a new IPC handler, caches it in a ref keyed by guild ID for the session, and derives the visible rows via `useMemo` from search, sort, and role-filter state.

Bulk actions reuse the existing per-user IPC permission/hierarchy guards but iterate on the main side; ban uses Discord's bulk-ban API (chunks of 200) when the array is large enough to benefit.

Virtualization via `react-window` (new dependency, ~6 kB) so 5k-member guilds stay smooth.

## UI

### Channel list entry

A row above the categories in `ChannelList`:

```
[👥] Members                                   [count]
```

- Same visual height + hover/selected styling as a regular channel row
- Selected state when `view === 'members'`
- Count is the total member count from `GuildSummary.memberCount`

### Toolbar (sticky top of MembersDirectory)

- Search input — filters across `displayName` and `username`, case-insensitive substring
- Role filter dropdown — populated from `listGuildRoles`; pick one → only members assigned that role
- Member count — filtered count when filter or search active, otherwise total

### Header row (sortable)

| ☐ | Name ▲ | Member since ▼ | Joined Discord | Roles | ⋯ |

- Master checkbox toggles selection across the *currently filtered* set
- Click a sortable column to set sort key; click again to flip direction
- Indicator chevron on the active sort column

### Body row (36 px tall, virtualized)

- Checkbox
- Avatar (24 px) + display name (color-coded by top role); `@username` shown muted next to it
- Member since: short date (`Apr 12, 2024`)
- Joined Discord: short date
- Roles: up to 3 color dots; `+N` chip if more. Tooltip lists all role names on hover.
- ⋯ button: opens the existing user context menu (Profile / Roles submenu / Timeout / Kick / Ban / Mention / Copy Username / Copy User ID), anchored to the button

### Bulk action bar (bottom, slides in when ≥1 row selected)

- `N selected` + Clear
- Buttons: Add role, Remove role, Kick, Ban
- Disabled tooltips when bot lacks the relevant permission

## Data Types

```ts
export type AllMembersEntry = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  status: PresenceStatus;
  isBot: boolean;
  joinedAt: number | null;       // ms epoch — null if unknown
  createdAt: number;             // ms epoch
  roleColor: string | null;      // "#rrggbb"
  topRole: MemberRole | null;
  roleIds: string[];             // excluding @everyone
};

export type BulkActionResult = {
  ok: string[];                  // user IDs that succeeded
  failed: Array<{ id: string; error: string }>;
};
```

## IPC Contract

| Channel | Args | Returns |
|---|---|---|
| `guilds.listAllMembers` | `guildId` | `Result<AllMembersEntry[]>` |
| `guilds.bulkAssignRole` | `guildId, userIds: string[], roleId` | `Result<BulkActionResult>` |
| `guilds.bulkRemoveRole` | `guildId, userIds: string[], roleId` | `Result<BulkActionResult>` |
| `guilds.bulkKickMembers` | `guildId, userIds: string[], reason?: string` | `Result<BulkActionResult>` |
| `guilds.bulkBanMembers` | `guildId, userIds: string[], opts: { reason?: string; deleteMessageSeconds?: number }` | `Result<BulkActionResult>` |

`listAllMembers` does `await guild.members.fetch()` (full chunk) then projects. If the privileged Members Intent isn't granted, the fetch returns an empty/partial set — handler returns whatever's in cache and signals via a top-level `intentMissing: true` flag passed alongside. (Implementation detail: wrap the response in `{ entries, intentMissing }` to keep the cache-fallback case explicit.)

Updated return type:

```ts
export type ListAllMembersResult = {
  entries: AllMembersEntry[];
  intentMissing: boolean;        // true if guild.members.fetch() failed
};
```

## Bulk Handler Behavior

- All four bulk handlers re-resolve the bot member and validate `ManageRoles` / `KickMembers` / `BanMembers` once at the top
- For each user ID:
  - Re-resolve target member from cache (or fetch); skip if not found (counts as failed)
  - Re-check hierarchy (`bot.topRolePosition > target.topRolePosition`)
  - Call discord.js method; on success push to `ok`, on failure push to `failed` with message
- discord.js handles HTTP rate limit retries internally — no manual throttle needed
- For `bulkBanMembers`: if `userIds.length > 1`, prefer `guild.bans.bulkCreate({ user: chunk })` in chunks of 200; fall back to per-member `member.ban(...)` for stragglers or if the bulk endpoint errors

## Files Changed

**New:**
- `src/renderer/components/MembersDirectory.tsx`
- `src/renderer/components/members/MembersToolbar.tsx`
- `src/renderer/components/members/MembersTable.tsx`
- `src/renderer/components/members/MembersBulkBar.tsx`
- `src/renderer/components/members/BulkRoleDialog.tsx` *(handles both add and remove modes)*
- `src/renderer/components/members/BulkKickDialog.tsx`
- `src/renderer/components/members/BulkBanDialog.tsx`
- `src/main/ipc/members-bulk.ts` *(new module — keeps `guilds.ts` from continuing to grow)*

**Modified:**
- `src/renderer/components/ChannelList.tsx` — render the Members pseudo-row + selected highlighting
- `src/renderer/routes/shell/ShellRoute.tsx` — view discriminator + last-view-per-guild
- `src/main/ipc/guilds.ts` — `listAllMembers` handler
- `src/main/ipc/index.ts` — register the new bulk handlers module
- `src/shared/ipc-contract.ts` — channel constants + `BotcordApi` entries
- `src/shared/domain.ts` — `AllMembersEntry`, `ListAllMembersResult`, `BulkActionResult` types
- `src/preload/expose.ts` — five new bindings
- `package.json` — add `react-window` and `@types/react-window`

## Edge Cases

- **Privileged Members Intent missing:** banner at the top of the directory ("Bot lacks Privileged Members Intent — directory shows cached members only"); proceeds with whatever is cached.
- **Guild switch while fetching:** in-flight fetch is discarded via the established `active` flag pattern used elsewhere in the renderer.
- **Empty result after filter/search:** centered empty state ("No members match").
- **Selection survives** sort/search; **cleared** on guild switch and on successful bulk action.
- **Bot is in the selection set:** filtered out client-side before any bulk call (bot can't moderate itself).
- **Hierarchy violations in selection:** included in the call; reported in the `failed` list of the result, surfaced as a summary toast/dialog at completion.

## Testing

- Manual: smoke against guilds of varying size (10, 500, 5k members); verify scroll smoothness, search responsiveness
- Manual: privileged-intent off and on; verify banner + cache fallback
- Manual: bulk role add to 50 members; bulk ban to 5; verify per-row success/failure summary
- Existing typecheck and lint must pass
