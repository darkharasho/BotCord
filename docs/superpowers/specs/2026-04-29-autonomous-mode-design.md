# Autonomous Mode — Design Spec

**Date:** 2026-04-29
**Status:** Approved for implementation planning
**Scope:** Add an "autonomous mode" to BotCord that uses `@claude-cdk/core` to generate Discord replies on the user's bot, plus a manual "Generate reply" UX that drafts into the composer.

## Goals

- When the bot is `@mentioned` (or replied to) in an opted-in channel, generate and send a reply via the local `claude` CLI through `@claude-cdk/core`.
- From any message in the renderer, let the user invoke "Generate reply with Claude" to produce a draft in the existing composer (human-in-the-loop send).
- Use recent channel history as **background context** (situational awareness), not as a conversation transcript Claude continues. Each reply targets one specific message.
- Configurable per guild: enable/disable, channel allowlist, context window size, persona, cooldown. Globally: kill switch, default persona, rate cap.
- Bring-your-own-credentials posture preserved: rely on the user's installed and authenticated `claude` CLI; no API keys stored in BotCord.

## Non-goals

- Renderer-side Claude chat panel. (`@claude-cdk/electron-host` / `-client` are not wired in this feature; they remain available for future work.)
- Streaming generated text directly into Discord by editing messages (rate-limit hostile).
- Multi-turn conversational memory across triggers (each generation is a fresh CDK session with hand-framed context).
- Tools / function calling / file edits via Claude. Pure text replies only.
- Voice channel autonomy.

## Architecture overview

A new main-process subsystem `src/main/autonomy/` owns:

1. A lazily-started long-lived `CDKHost` from `@claude-cdk/core`.
2. A second `MessageCreate` listener registered alongside the existing one in `src/main/discord/client-manager.ts`.
3. An in-memory throttle (per-channel cooldown + global token bucket + single-in-flight-per-channel guard).
4. A prompt builder that assembles background context + target message + per-guild persona.
5. New IPC handlers under the `autonomy.*` namespace.
6. A new SQLite table `autonomy_guild_config` (migration v2) and three new keys on the existing `prefs` table.

The renderer never imports CDK. It speaks only to main IPC. New renderer surface:

- A guild-settings "Autonomy" tab.
- An app-settings "Autonomy" section.
- A "Generate reply with Claude" affordance on the message hover toolbar / context menu that drafts into the existing composer.

## Trigger logic

**Autonomous trigger** fires on `messageCreate` when ALL of:

- Global kill switch (`autonomyGlobalEnabled`) is on.
- Guild config exists, `enabled = true`, and `message.channelId` is in `channel_ids`.
- Author is not a bot (covers self and other bots — prevents loops).
- Message is not a system message.
- Bot is mentioned via `message.mentions.has(client.user)` OR the message is a reply (`message.reference`) to a message authored by the bot.
- Per-channel cooldown elapsed and global rate cap not exceeded.
- No in-flight generation already running for this channel.

**Manual trigger** is `autonomy.draftReply(channelId, messageId)` from the renderer:

- Bypasses the allowlist, cooldown, and rate cap (user-initiated, low volume).
- Still respects the global kill switch — if global is off, returns an explanatory error.
- Streams `draftDelta` events to the requesting renderer; final `draftDone` carries the assembled text.

## Context assembly

Same builder for both paths:

1. Fetch the last *N* messages in the channel via `channel.messages.fetch({ limit: N + 1 })` (then drop the trigger message itself). *N* defaults to 20, configurable per guild, hard-capped at 100.
2. Render each as `displayName (userId) [HH:MM]: content`. Strip Discord-only formatting that doesn't carry meaning (custom emoji syntax stays as-is; mentions resolved to display names where possible).
3. Compose prompt sections:
   - **System prompt:** per-guild `system_prompt` if non-null, else `autonomyGlobalSystemPrompt`. Prefixed with hard rules:
     - Stay in character.
     - Reply with exactly one Discord message.
     - Never use `@everyone` or `@here`.
     - Keep replies under 2000 characters.
   - **Background block:** "Recent channel context — for situational awareness only. Do NOT respond to these messages." followed by the rendered history.
   - **Target block:** "Respond to this single message:" followed by the rendered triggering message.
   - **Channel metadata:** guild name, channel name, channel topic if set.
4. CDK `cwd`: a stable scratch dir at `app.getPath('userData')/cdk-scratch`. Created on first use. Content irrelevant for chat use; we just need a valid directory for the CLI.
5. Each generation calls `host.startSession({ cwd })`, then iterates `session.send(prompt)` collecting `assistant.text_delta` events into a buffer, terminating on `session.done`, then `session.close()`. No `resumeSession`.

## Data model

### New SQLite migration v2

```sql
CREATE TABLE autonomy_guild_config (
  guild_id        TEXT PRIMARY KEY,
  enabled         INTEGER NOT NULL DEFAULT 0,
  channel_ids     TEXT    NOT NULL DEFAULT '[]',
  context_size    INTEGER NOT NULL DEFAULT 20,
  system_prompt   TEXT,
  cooldown_ms     INTEGER NOT NULL DEFAULT 5000,
  updated_at      INTEGER NOT NULL
);
```

### New repo

`src/main/db/repos/autonomy.ts` exposes:

- `getGuildConfig(guildId): GuildAutonomyConfig` — returns defaults (enabled: false, channel_ids: [], context_size: 20, system_prompt: null, cooldown_ms: 5000) if no row exists.
- `upsertGuildConfig(guildId, partial)`
- `setChannelEnabled(guildId, channelId, enabled)` — convenience helper.

### Prefs additions

Extend `Prefs` in `src/shared/domain.ts` and the prefs whitelist in `src/main/ipc/prefs.ts`:

- `autonomyGlobalEnabled: boolean` — default `false`.
- `autonomyGlobalSystemPrompt: string` — default: a concise, friendly, helpful Discord assistant persona.
- `autonomyGlobalRateCapPerMin: number` — default `20`.

### Caching

The autonomy module keeps a `Map<guildId, GuildAutonomyConfig>` cache populated on read and invalidated on write. Avoids hitting SQLite on every incoming message.

## IPC contract

Added to `src/shared/ipc-channels.ts` and the preload's `botcord.autonomy.*` namespace:

| Channel | Args | Returns |
|---|---|---|
| `autonomy.detect` | — | `{ found: boolean, version?: string, reason?: string }` |
| `autonomy.getGuildConfig` | `guildId` | `GuildAutonomyConfig` |
| `autonomy.setGuildConfig` | `guildId, partial: Partial<GuildAutonomyConfig>` | updated config |
| `autonomy.getGlobalConfig` | — | `{ enabled, systemPrompt, rateCapPerMin }` |
| `autonomy.setGlobalConfig` | `partial` | updated |
| `autonomy.draftReply` | `channelId, messageId` | `{ ok: true, requestId, text } \| { ok: false, error }` |
| `autonomy.cancelDraft` | `requestId` | `{ ok: true }` |
| `event.autonomy.draftDelta` (broadcast) | `{ requestId, delta }` | — |
| `event.autonomy.draftDone` (broadcast) | `{ requestId, text, stopReason }` | — |

Drafts emit deltas to all renderer windows (matches existing event-broadcast pattern); the renderer filters by `requestId`.

## Renderer UI

### Guild settings → new "Autonomy" tab

- Detection banner at top if `autonomy.detect()` returns `found: false`, with the `reason` shown verbatim and a link to install instructions (external).
- Master toggle (writes `autonomy_guild_config.enabled`).
- Channel allowlist multiselect populated from text channels visible to the bot (reuses existing channel-list data source).
- Context size slider, range 5–100, default 20.
- Persona textarea with placeholder showing the resolved global default; empty value means "use global."
- Cooldown input (ms), default 5000, min 1000.
- Save button writes via `autonomy.setGuildConfig`.

### App settings → "Autonomy" section

- Global kill switch.
- Default persona textarea.
- Global rate cap input (per minute).

### Message hover toolbar / context menu

- New item "Generate reply with Claude" on each message (added to whatever message-action surface exists in `src/renderer/components/`; adopt the existing pattern for the "Reply" / reaction buttons).
- On click: calls `autonomy.draftReply(channelId, messageId)`. While streaming, the existing channel composer shows a subtle "Generating with Claude…" indicator and a Cancel button (calls `autonomy.cancelDraft(requestId)`).
- `draftDelta` events append to the composer's draft text. `draftDone` finalizes. The user reviews and hits send themselves (or edits/discards). No auto-send.
- If the user is typing already, we do not clobber existing composer content — instead show the streamed draft in a small popover with "Insert" / "Replace" / "Discard" actions. (Spec note: prefer the popover approach if implementation cost is similar; otherwise the simpler "stream into empty composer, abort if non-empty" path is acceptable.)

### Autonomous path

Does not stream to the renderer. The bot sends the reply to Discord; the existing `messageCreate` broadcast carries it back to all windows like any other message.

## Throttling

Autonomous path only — manual is unbounded.

- **Per-channel cooldown:** `Map<channelId, lastFiredAt>` consulted before queuing. Default 5000ms, per-guild configurable.
- **Global token bucket:** sized to `autonomyGlobalRateCapPerMin` (default 20). Refilled linearly. Over-limit triggers are dropped silently with a debug log.
- **Single-in-flight per channel:** `Set<channelId>` of running generations. New triggers while busy are dropped (prevents the bot interleaving on itself).
- **Mid-flight cancellation:** if the channel is removed from the allowlist or the global kill switch flips off while a generation is running, call `session.abort()` and discard.

## Error handling

- **CLI not detected:** autonomous path no-ops with a one-time warning log per app session. Manual path returns `{ ok: false, error: 'claude CLI not found: <reason>' }`. Settings UI banner shows `detect().reason` verbatim.
- **CDK process crash / non-zero exit:** log via existing logger, drop the response, no retry.
- **Discord send failure:** log, no retry (avoids duplicate sends if the failure was a network blip after a successful internal commit).
- **Output > 2000 chars:** truncate at the last sentence boundary (`. ! ?` followed by whitespace) before send. If no boundary in the first 2000 chars, hard-truncate.
- **Mention safety:** strip `@everyone` and `@here` from generated text before sending. The system prompt also forbids them; this is defense in depth.
- **Empty / whitespace-only output:** drop, do not send.

## Testing

Vitest, matching existing patterns under `src/**/__tests__/` (or wherever the repo conventionally places tests).

### Unit

- Prompt builder: background-vs-target block layout, truncation, mention resolution, channel-metadata inclusion.
- Output post-processing: 2000-char truncation at sentence boundary, `@everyone` / `@here` stripping, empty-output rejection.
- Throttle: cooldown skip, rate-cap drop, single-in-flight drop, mid-flight abort on config change.
- Trigger filter: bot author skip, system message skip, non-allowed channel skip, mention vs reply detection.
- `autonomy` repo CRUD against an in-memory better-sqlite3.

### Integration

- Inject a fake `CDKHost` (the autonomy module accepts it via constructor) that yields scripted event streams: text deltas → `session.done`. Exercises the auto path end-to-end up to a mocked `channel.send` boundary.
- A second fake host scenario for `session.abort()` mid-stream.

### Manual smoke checklist (in spec, run before ship)

- Real `claude` CLI installed & authenticated:
  - Mention the bot in an allowlisted channel → reply lands.
  - Reply to one of the bot's messages → reply lands.
  - Mention in a non-allowlisted channel → no reply.
  - Toggle global kill switch off → no replies.
  - Click "Generate reply" on a message → composer fills with draft, user can edit and send.
- `claude` CLI uninstalled or unauthenticated → settings banner shows reason, autonomous path silent, manual path errors gracefully.
- Two rapid mentions in the same channel inside the cooldown window → only the first replies.

## File-level change list (preview)

New:
- `src/main/autonomy/index.ts` — module entry, wires listener and host.
- `src/main/autonomy/prompt.ts` — context assembly.
- `src/main/autonomy/throttle.ts` — cooldown + rate cap + in-flight set.
- `src/main/autonomy/post-process.ts` — truncation, mention stripping.
- `src/main/db/repos/autonomy.ts`
- `src/main/db/migrations/002_autonomy.ts` (matching existing migration file naming)
- `src/main/ipc/autonomy.ts`
- `src/renderer/components/AutonomySettings.tsx` (guild tab)
- `src/renderer/components/GlobalAutonomySettings.tsx` (app section)

Modified:
- `src/main/discord/client-manager.ts` — register autonomous listener.
- `src/main/index.ts` — instantiate autonomy module after DB and Discord.
- `src/preload/expose.ts` — expose `botcord.autonomy.*`.
- `src/shared/ipc-channels.ts` — new channels.
- `src/shared/domain.ts` — new types (`GuildAutonomyConfig`, prefs additions).
- `src/main/ipc/prefs.ts` — whitelist new keys.
- Existing message-action component — add "Generate reply with Claude" item.
- `package.json` — add `@claude-cdk/core` dependency.

## Open questions for implementation

- Composer integration shape (popover with Insert/Replace/Discard vs stream-into-empty-composer): pick during implementation based on what the existing composer component supports. Either is acceptable.
- Default global system prompt wording — finalize during implementation; should be neutral, helpful, and explicitly aware that the bot is in a Discord text channel.
