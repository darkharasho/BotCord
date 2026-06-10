# Embed Composer — Design

**Date:** 2026-06-10
**Status:** Approved (pending implementation plan)

## Overview

Add the ability to compose, send, edit, and delete rich Discord embeds through
the bot. The feature is delivered as a single modal (`EmbedModal`) launched from
the channel composer's `+` menu — mirroring the existing `PollModal` pattern —
with a live preview, optional message content, full embed field support, saved
drafts, and edit/delete of already-sent embeds via the standard message hover
menu.

## What already exists (reused, not rebuilt)

The backend plumbing for embeds is largely complete and currently unused from
the UI:

- **Domain type** `EmbedPayload` (`src/shared/domain.ts`) — title, description,
  url, color, timestamp, footer, author, thumbnail, image, fields.
- **Send path** `buildEmbed()` + `messages.sendEmbed` IPC handler
  (`src/main/ipc/messages.ts`) and `api.messages.sendEmbed(channelId, embed,
  content?)` (`src/preload/expose.ts`). Already accepts an optional `content`
  string sent alongside the embed.
- **Drafts** full SQLite-backed repo with an `embed_json` column
  (`src/main/db/repos/drafts.ts`), IPC (`src/main/ipc/drafts.ts`), and
  `api.drafts.{list,upsert,delete}`. `DraftRow.embed` is an `EmbedPayload | null`.
- **Renderer** `EmbedCard` (`src/renderer/components/EmbedCard.tsx`) renders a
  `MessageEmbedSummary` exactly as it appears in the channel.
- **Delete** `api.messages.delete(channelId, messageId)` — already wired into the
  message hover menu.
- **Hover menu** `MessageGroup.tsx` already exposes Edit/Delete actions gated on
  `isOwn` (the bot's own messages).

What is missing is entirely renderer UI plus **one** new IPC handler for editing
embeds. The orphaned `/compose` route placeholder is **not** used by this design
and is left untouched (it can be removed or repurposed separately).

## Architecture

One component, `EmbedModal`, operating in two modes over shared form state:

- **Create mode** — opened from the `+` menu. "Send" calls
  `api.messages.sendEmbed(channelId, embed, content)`.
- **Edit mode** — opened from a message's hover "Edit" action when that message
  is the bot's own and carries a single rich embed. Pre-filled from the message.
  "Save" calls the new `api.messages.editEmbed(channelId, messageId, embed,
  content)`.

Drafts are a state layer available in both modes (load on open via dropdown,
save via "Save draft"), not a separate mode.

### Two adapters

The app has two embed shapes: `EmbedPayload` (compose/send input) and
`MessageEmbedSummary` (rendered/received). Two pure functions bridge them, placed
in a new `src/renderer/lib/embed-adapters.ts` with unit tests:

- `payloadToSummary(p: EmbedPayload): MessageEmbedSummary` — lets the live
  preview reuse the real `EmbedCard`, so the preview is pixel-accurate to the
  sent result. Maps `color?: number` through, fills `MessageEmbedSummary`'s
  required-but-absent fields (`type: 'rich'`, `provider: null`, `video: null`,
  width/height `null`, `fields: []` when empty), and converts
  `timestamp?: string` (ISO) ↔ `number | null` (ms).
- `summaryToPayload(s: MessageEmbedSummary): EmbedPayload` — pre-fills the editor
  from a sent message. Drops non-editable/auto fields (provider, video,
  width/height); converts timestamp ms → ISO string.

### New IPC handler: `messages.editEmbed`

`messages.edit` today only accepts `content: string`. Add a sibling handler that
edits embeds:

- **Channel:** `messages.editEmbed`
- **Signature:** `editEmbed(channelId, messageId, embed: EmbedPayload, content?: string)`
- **Main handler:** validates args, fetches the message via the existing
  `requireSendableChannel` helper, calls `msg.edit({ embeds: [buildEmbed(embed)],
  content: content ?? '' })`, returns `Result<MessageSummary>`.
- Reuses the existing `buildEmbed()` so create and edit stay consistent.
- Added to `IPC_CHANNELS`, `BotcordApi` (contract), `expose.ts`, and the renderer
  `api`.

## Components & data flow

```
Composer ( + menu )
   └─ "Create embed" ──▶ EmbedModal(mode="create", channelId, guildId)
                              │  sendEmbed(channelId, payload, content)
                              ▼
                         channel message  ─────────────┐
                                                        │ rendered by EmbedCard
MessageGroup (hover menu, isOwn + single rich embed)    │
   └─ "Edit" ──▶ EmbedModal(mode="edit",                ▼
                  message, prefill=summaryToPayload(embed))
                       │  editEmbed(channelId, messageId, payload, content)
                       ▼
                  updated message
```

- **`EmbedModal` props:** `{ channelId, guildId, onClose }` plus either nothing
  (create) or `{ messageId, initialContent, initialEmbed }` (edit).
- **Live preview:** `<EmbedCard embed={payloadToSummary(payload)} />` re-rendered
  on every keystroke; the optional content line is shown above it as plain text.
- **`+` menu entry:** add a "Create embed" item to the existing plus-menu in
  `Composer.tsx` (next to "Create a poll"); guild-only (not DM), disabled when no
  channel selected. Opens `EmbedModal` like `PollModal`.
- **Hover-menu routing:** in `MessageGroup.tsx`, when the Edit action fires for a
  message that `isOwn` and has exactly one embed with `type === 'rich'`, open
  `EmbedModal` in edit mode instead of the inline text editor. All other messages
  (text-only, link previews, multi-embed) keep the existing inline textarea
  editor. Delete is unchanged.

## Form fields (v1 — full set)

`EmbedPayload`/`buildEmbed` already support all of these:

- Message content (optional, sent above the embed)
- Author: name, url, icon url
- Color (color picker → number)
- Title + url
- Description
- Fields: add/remove, each name + value + inline toggle
- Thumbnail url
- Image url
- Footer: text + icon url
- Timestamp toggle (sets `timestamp` to now / clears it)

### Validation (Discord limits)

Enforced live; "Send"/"Save" disabled until valid and the embed is non-empty:

- Title ≤ 256, description ≤ 4096, field name ≤ 256, field value ≤ 1024,
  footer text ≤ 2048, author name ≤ 256.
- Max 25 fields (Discord's limit).
- Combined character count ≤ 6000, shown live in the footer.
- URL fields must be valid http(s) URLs when non-empty.
- "Non-empty embed" = at least one of title/description/author/footer/image/
  thumbnail/fields is set. (Content-only is not an embed — use the normal
  composer.)

## Drafts

- **Load:** header dropdown lists `api.drafts.list()` entries that have a
  non-null `embed`; selecting one populates content + all embed fields.
- **Save:** "Save draft" prompts for a name and calls `api.drafts.upsert({ name,
  guildId, channelId, content, embed })`. Existing drafts can be overwritten by
  reusing their id (future enhancement; v1 may always create new).
- Drafts are not channel-bound at send time — the modal always sends to the
  channel it was opened for.

## Error handling

- All IPC calls return the existing `Result<T>` discriminated union; failures
  surface via `pushToast('danger', …)` exactly as `PollModal` does.
- Gateway-offline / not-sendable channel errors are already produced by
  `requireSendableChannel` and shown to the user.
- Edit of a message the bot doesn't own will fail at the Discord API; the UI
  avoids this by only offering embed-edit on `isOwn` messages.

## Testing

- **Unit (vitest):** `embed-adapters.test.ts` — round-trip `payloadToSummary`/
  `summaryToPayload`, color and timestamp conversions, empty-field handling.
- **Unit (main):** `messages.editEmbed` handler — arg validation, success path
  (mock channel `messages.fetch` + `msg.edit`), error mapping. Mirrors existing
  `messages.test` style if present.
- **Component (RTL):** `EmbedModal` — validation gating (Send disabled until
  valid), live char count, add/remove field, draft load populates fields, create
  vs edit submit calls the right api method with the built payload.
- Respect the repo's vitest worker cap (≤2).

## Out of scope (v1)

- Multiple embeds per message (Discord allows up to 10). Edit targets a single
  rich embed; multi-embed messages keep the inline editor.
- Editing auto-generated link/image/video preview embeds (not editable as rich
  embeds via the API).
- The standalone `/compose` full-page route / drafts library page.
- Image **uploads** for thumbnail/image (URLs only in v1; the existing
  attachment path is separate).
- Per-field emoji pickers inside embed text (markdown/emoji shortcodes still
  work through `buildEmbed`'s passthrough).
