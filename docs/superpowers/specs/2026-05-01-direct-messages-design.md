# Direct Messages — Design

**Status:** Draft
**Date:** 2026-05-01

## Goal

Give BotCord full parity with Discord's DM surface, mediated through the user's bot. Admins can send DMs, view past conversations with anyone the bot has interacted with, receive incoming DMs in real time, and start new conversations with members of any guild the bot is in.

## Constraints (Discord API)

- Bots can only DM users who share a guild with the bot.
- Bots cannot enumerate "all DM channels with the bot" — there is no such API. DM channels are only known to the bot when (a) the bot creates one via `user.createDM()`, or (b) a user sends the bot a DM during a session.
- While the bot is offline, brand-new DM conversations (from users the bot has never interacted with) are unrecoverable. Messages in *known* DM channels can be backfilled on reconnect via `messages.fetch({ after: lastMessageId })`.

## Architecture

A new top-level "Home" surface, accessed from a button at the top of the server rail. The existing three-pane shell is reused: rail → DM list → conversation. The conversation pane is the existing `<MessageList>` + `<Composer>`, channel-keyed exactly as today.

DM channels are persisted as a lightweight index in SQLite. Messages themselves are not persisted — they are fetched live from Discord, identical to guild channels. The persisted index seeds backfill on reconnect.

### New files
- `src/main/db/migrations/` — migration adding `dm_channels` table
- `src/main/db/repos/dm-channels.ts` — repo (upsert, list, get, markInert)
- `src/main/discord/dm-listener.ts` — gateway → persistence + event fan-out
- `src/main/ipc/dms.ts` — IPC namespace
- `src/renderer/components/DMList.tsx`, `DMListItem.tsx`
- `src/renderer/components/NewDMModal.tsx`
- Routing handled inline in `ShellRoute` via a new `view: 'home' | 'guild'` state — no new route file

### Files modified
- `src/main/discord/intents.ts` — add `DirectMessages`, `DirectMessageTyping`
- `src/main/ipc/index.ts` — register dms namespace
- `src/preload/index.ts` (or wherever `api.*` is exposed) — expose `api.dms.*`
- `src/renderer/components/ServerRail.tsx` — Home button at top of rail
- `src/renderer/routes/shell/ShellRoute.tsx` — `view` state + Home routing
- `src/renderer/lib/use-unreads.ts` — DM unread/mention rollup, `markDMsRead()`
- `src/renderer/components/settings/sections/NotificationsSection.tsx` — `notifyOnDM` toggle
- `src/renderer/routes/onboarding/steps/Step3Intents.tsx` — copy update for DM intent

### Files reused unchanged
- `Composer`, `MessageList`, `MessageGroup`, `MessageContent`, `AttachmentTray`, `EmojiPicker`, `UserProfileCard`, `Toaster`, `MembersDirectory` (or its hook)
- `drafts` repo — already channel-keyed, works for DM channels with no change

## Data model

```sql
CREATE TABLE dm_channels (
  channel_id           TEXT PRIMARY KEY,    -- Discord DM channel snowflake
  user_id              TEXT NOT NULL,
  user_username        TEXT NOT NULL,
  user_global_name     TEXT,
  user_avatar          TEXT,
  last_message_id      TEXT,
  last_message_preview TEXT,
  inert                INTEGER NOT NULL DEFAULT 0,  -- 1 if channel is unreachable (deleted, user blocked bot, etc.)
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX idx_dm_channels_user ON dm_channels(user_id);
CREATE INDEX idx_dm_channels_updated ON dm_channels(updated_at DESC);
```

User identity fields are cached so the DM list renders before the gateway is ready. Refreshed whenever the user is observed.

## Main process

### Intents (`src/main/discord/intents.ts`)
Add `GatewayIntentBits.DirectMessages` and `GatewayIntentBits.DirectMessageTyping`. `MessageContent` is already enabled and applies to DMs.

### Listener (`src/main/discord/dm-listener.ts`)
Subscribes to `messageCreate`, `messageUpdate`, `messageDelete`, `typingStart`. For events where `channel.type === DM`:
1. Upsert the `dm_channels` row (user info, `last_message_id`, `last_message_preview`, `updated_at`).
2. Forward to renderer over the existing `messageCreate`/`messageUpdate`/`messageDelete` IPC channels. The event shape is unchanged — the absence of `guildId` already identifies a DM.

### Backfill on `clientReady`
Iterate `dm_channels` rows where `inert = 0`. For each, `client.channels.fetch(channel_id)` then page `messages.fetch({ after: last_message_id, limit: 100 })` until empty. Each message is fed through the same listener path so unread state and notifications behave identically to live messages.

- Bounded concurrency: 4 channels in flight.
- On `Unknown Channel` / `Missing Access`: mark the row `inert = 1`, do not delete.
- On 429 escalation: log and abort that channel; will retry on next ready event.
- Failures never block app readiness.

### IPC (`src/main/ipc/dms.ts`)
All return the existing `Result<T>` shape.
- `dms.list()` → `DMChannelRow[]` ordered by `updated_at DESC`. Excludes `inert` rows by default; accepts `{ includeInert: true }`.
- `dms.fetchMessages(channelId, { before?, limit? })` → live fetch from Discord, identical shape to guild channel messages.
- `dms.openWithUser(userId)` → resolves/creates DM via `user.createDM()`, upserts row, returns it.
- `dms.send(channelId, payload)` → reuses existing message-send pipeline (content, embeds, attachments).
- `dms.markRead(channelId)` → mirrors guild channel mark-read.
- `dms.close(channelId)` → mark row `inert = 1` locally (Discord has no concept of closing a DM).

## Renderer

### ServerRail Home button
Pinned at the top of the rail above the guild list, separated by the existing divider.

- Square rounded tile matching guild-icon dimensions.
- **Inactive:** medium-gray tile background (slightly lighter than rail), white `botcord-white.svg` glyph centered.
- **Hover (inactive):** lift to a lighter gray, mirroring guild tile hover.
- **Active:** background = brand green `#007f68` (from `botcord-icon.svg`), white glyph centered.
- **Selection pill:** the existing left-edge active pill, applied to the Home button as well.
- **Badge:** same as guild tiles — red mention count (bottom-right) when `dmMentionCount > 0`, gray unread dot when `dmUnreadChannelIds.size > 0` and no mentions.

### Shell routing (`ShellRoute.tsx`)
`view: 'home' | 'guild'` state. When `home`:
- Middle pane: `<DMList>` instead of `<ChannelList>`.
- Right pane: `<MessageList>` + `<Composer>` keyed on the selected DM channelId, with a DM-specific header.

### `<DMList>`
- Search box at top (filters by username / global name).
- "+ New DM" button → opens `<NewDMModal>`.
- Vertical list of `<DMListItem>` ordered by `updated_at DESC`.
- Each item: avatar, display name, truncated last-message preview, relative time, unread dot, mention count.
- Right-click context menu: mute, mark read, close conversation.

### `<NewDMModal>`
Member picker reusing `MembersDirectory` (or its hook). Searches members across all guilds the bot is in. On select → `dms.openWithUser(userId)`. Inline error if the user has DMs disabled or shares no guilds.

### Conversation header (DM mode)
Avatar + display name + username + "View profile" button (opens `<UserProfileCard>`). Replaces the channel-name/topic header used in guild mode.

### Composer in DM mode
Identical to guild composer minus:
- Channel-mention autocomplete (`#channel`) — meaningless in DMs.
- Role-mention autocomplete — DMs have no roles.
User-mention autocomplete is allowed.

When `dms.send` returns `Cannot send to this user`, surface as a toast and disable the composer with an inline reason.

## Unreads & notifications

### `useUnreads` extensions
- New derived values: `dmUnreadChannelIds: Set<string>`, `dmMentionCount: number` (rolled up across all DM channels).
- New action: `markDMsRead()` — walks `dm_channels` instead of guild channels.
- DM channels are special-cased in mention counting: every non-bot message in a DM increments the mention count (not just `@-mentions`), since the bot is always the recipient. This makes the Home badge behave like Discord's.
- `lastSeen` persistence already keys on channelId — DM read state survives restart with no schema change.

### OS notifications
A new `notifyOnDM` toggle in `NotificationsSection` (default: on). On a DM `messageCreate`:

- Suppress if BotCord is focused **and** the DM is the active view (matches Discord).
- Suppress if the channel is muted.
- Otherwise show:
  - Title: sender's display name
  - Body: truncated content; `[attachment]` / `[embed]` placeholders if no text
  - Click: focus BotCord, switch to Home view, select the DM.

Backfilled messages flow through the same path, producing a single notification burst when reopening with offline DMs waiting.

## Edge cases

- **User leaves all mutual servers:** reading existing messages still works; `dms.send` returns `Cannot send to this user`. Composer disabled with inline reason.
- **User has DMs disabled:** `dms.openWithUser` returns the same error; New DM modal shows inline error.
- **Bot lacks `DirectMessages` intent:** Home view renders an empty state with "Direct Messages intent not enabled" + link to onboarding.
- **Channel deleted / unknown:** row marked `inert = 1`; filtered from default list; "show closed" toggle re-includes them.
- **Message edits/deletes:** same pipeline as guild messages; `useUnreads` prunes deleted-message mentions.
- **Self-DM:** not a real bot scenario; ignored.
- **Drafts:** existing `drafts` repo is channel-keyed, works unchanged.

## Testing

**Unit**
- `dm-channels` repo CRUD + `inert` semantics.
- `dm-listener` upsert correctness (preview truncation, `updated_at`).
- Backfill pagination (continues until empty, handles 429 abort, marks `Unknown Channel` inert).
- `useUnreads` DM-mention counting (every incoming DM counts; bot's own outgoing messages don't).

**Integration**
- IPC namespace round-trips with a mocked discord.js client.
- `dms.openWithUser` upsert + return shape.
- `dms.send` error path → toast + disabled composer.

**Component**
- `<DMList>` ordering, unread/mention rendering, mute toggle.
- `<NewDMModal>` member search + open flow + DMs-disabled error.
- `ServerRail` Home button states: inactive / hover / active / with badge / with mention count.

**Manual smoke**
- Send DM outbound → appears in list.
- Receive DM inbound → list bumps + notification fires.
- Mute conversation → no notification, no badge, mention still increments? (no — muted suppresses everything per existing behavior).
- Restart BotCord with offline DMs queued in a known channel → backfill fires, notifications burst, list updates.
- DM a user with DMs disabled → inline error in modal.

## Out of scope

- Persisting DM message bodies locally (channel index only; messages stay live-fetched).
- Discovering new DM conversations that started while offline (requires HTTP interactions endpoint).
- Group DMs (bots cannot be in group DMs).
- Voice/video DM calls.
