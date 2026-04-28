# Discord-Style Shell Design

**Goal:** Rework the BotCord shell so it looks and feels like Discord proper. Three coordinated sub-systems land together: an icon-only server rail, a Discord-style channel list, a live message history view with infinite scroll, and a real chat composer with attachments and an emoji picker (unicode + custom guild).

**Why now:** Today's shell is functional but utilitarian. Users expect Discord ergonomics. This is the foundation every other feature (compose embeds, bulk delete, etc.) will live inside.

**Stack:** Existing — Electron + React + TS, discord.js v14, TanStack Query (used selectively, mostly raw hooks for live data), Tailwind, no new heavy deps.

---

## Architecture

### Three-pane layout (revised)

| Pane | Width | Component |
|---|---|---|
| Server rail | 72px | `ServerRail` — icon-only, hover→circle, tooltip |
| Channel list | 240px | `ChannelList` — collapsible categories, threads nested |
| Channel view | flex 1 | `MessageList` (scroll) + `Composer` (sticky bottom) |

### New IPC events (main → renderer)

- `event.messageCreate` → `{ channelId, message: MessageSummary }`
- `event.messageUpdate` → `{ channelId, message: MessageSummary }`
- `event.messageDelete` → `{ channelId, messageId }`
- `event.guildEmojisUpdate` → `{ guildId, emojis: GuildEmoji[] }`

### New IPC requests

- `messages.sendWithAttachments(channelId, content, attachments)` — `attachments: { name, mimeType, bytes: Uint8Array }[]`. Returns `Result<MessageSummary>`.
- `guilds.listEmojis(guildId)` — returns `Result<GuildEmoji[]>`.

### Domain extensions (`src/shared/domain.ts`)

```ts
type MessageAttachment = {
  id: string; name: string; url: string; size: number;
  contentType: string | null; width: number | null; height: number | null;
};

type MessageEmbedSummary = {
  title: string | null; description: string | null; url: string | null;
  color: number | null; image: string | null; thumbnail: string | null;
  authorName: string | null; footerText: string | null;
  fields: Array<{ name: string; value: string; inline: boolean }>;
};

type ResolvedMention = { type: 'user' | 'channel' | 'role'; id: string; name: string };

type GuildEmoji = { id: string; name: string; animated: boolean; guildId: string; url: string };

type MessageSummary = { /* existing fields */
  authorAvatarUrl: string | null;
  attachments: MessageAttachment[];
  embeds: MessageEmbedSummary[];
  mentions: ResolvedMention[];
  replyTo: { id: string; authorTag: string } | null;
};
```

### Allowlist additions

`system.openExternal` allowed prefixes gain:
- `https://cdn.discordapp.com/attachments/`
- `https://media.discordapp.net/`

### Renderer dependency policy

No new heavy npm packages. Unicode emoji data ships as a small static dataset (`emoji-data.ts`, ~30KB). Markdown parsing is a hand-rolled subset parser under `lib/markdown.ts` — discord.js does not ship a renderer-side markdown parser and pulling in `marked` or `remark` exceeds what we need.

---

## Components

### `ServerRail` (replaces `GuildList`)

72px column. For each guild:
- 48px square avatar with `rounded-2xl` (Discord uses a 16px radius). Hover transitions to `rounded-full` over 150ms.
- Selected guild renders a 4×40 white pill on the left edge.
- Tooltip (right-side, via `Tooltip` primitive) shows the guild name on hover.
- Falls back to a 2-letter monogram if `iconUrl` is null.

### `ChannelList` (rewritten)

240px column. Channels are grouped by `parentId`:
1. Build map: `categoryId → ChannelSummary[]`.
2. Top-level (no parent) channels render first, ungrouped.
3. Each category renders as a `CategoryGroup` (collapsible header + child channels).
4. Threads (type `thread`) nest under their parent text channel as a sub-list.

Collapsed category state lives in component memory (a `Set<string>`). Persisted across re-mounts via the existing `prefs` IPC under a new key `collapsedCategoryIds: string[]` — added to the `Prefs` type.

Header row at the top shows the guild name and (optional later) member count.

### `MessageList`

- Mounts on channel select. Calls `messages.history(channelId, { limit: 50 })`.
- Subscribes to `event.messageCreate`/`Update`/`Delete` and filters by `channelId`.
- Auto-scrolls to bottom on initial load.
- On new live `messageCreate`: append. If user is within 100px of the bottom, smooth-scroll. Else show a "↓ Jump to present (N new)" pill above the composer.
- On scroll near top (within 200px): fetch 50 more with `before=oldestId`. Preserve scroll position by anchoring on the previously-oldest message's `getBoundingClientRect().top`.
- Stops paginating when a fetch returns fewer than 50 messages.

### `MessageGroup` / `MessageContent`

Discord-style author grouping: consecutive messages from the same `authorId` within 5 minutes render as one group. First message in the group: avatar (40px) + author name + timestamp + content. Subsequent messages in the group: indented content only, faint hover-only timestamp.

### `Markdown.tsx` + `lib/markdown.ts`

Pure parser → token tree, then renderer. Token types:
`text | bold | italic | strike | code_inline | code_block | blockquote | spoiler | link | mention_user | mention_channel | mention_role | custom_emoji | line_break`.

Mention name resolution comes from the `MessageSummary.mentions` array (resolved server-side at projection time) — the renderer just looks up the id.

Custom emoji renders as `<img src="https://cdn.discordapp.com/emojis/{id}.{png|gif}" class="inline w-5 h-5">`.

Spoiler: rendered as `<span>` with a black overlay; clicking removes the overlay.

### `EmbedCard`

Left-bordered card (`border-l-4`). Color from embed.color. Renders title (link if `url`), description (markdown), fields (grid 2-col when `inline`), thumbnail (top-right), image (bottom). Footer line at bottom.

### `Composer`

Sticky at the bottom of the channel pane. Inner layout:

```
┌────────────────────────────────────────────┐
│  AttachmentTray (hidden if empty)          │
├──┬──────────────────────────────────┬──┬───┤
│📎│ <textarea: auto-resize, max 10>  │😀│ ▶ │
└──┴──────────────────────────────────┴──┴───┘
```

- `Enter` sends. `Shift+Enter` newline.
- Disabled with banner when gateway is not `ready`.
- Send button enabled when content non-empty OR attachments present.
- Submit collects `{ channelId, content, files: File[] }`. For each file, reads `file.arrayBuffer()`, transfers as `Uint8Array` over IPC.

### Drag-and-drop

The channel pane (everything from history through composer) is a drop zone. While drag is active over the pane: a translucent overlay reads "Drop to attach". On drop: files merge into the existing tray, capped at 10 total. Files >25MB rejected with a toast.

### `AttachmentTray`

Horizontal scroll row. Each `File` renders as a 80px card:
- Image: `URL.createObjectURL` thumbnail.
- Other: a doc icon + filename (truncated) + size (`12 KB`, `3.2 MB`).
- Hover shows × button to remove.

ObjectURLs are revoked on unmount and on remove.

### `EmojiPicker`

Popover anchored above the emoji button (`absolute bottom-full right-0`). Two tabs:
- *Server*: hits `useGuildEmojis(currentGuildId)`. Grid of 32px buttons. Click inserts `<:name:id>` (or `<a:name:id>` for animated) at the textarea's current cursor position.
- *Standard*: grid of unicode emoji from `emoji-data.ts`, organized by category. Click inserts the literal char.

Shared search input at top filters both tabs by `keywords` field.

Closes on outside click or `Esc`.

### `Tooltip`

Small primitive: hover triggers a positioned `<div>` with the label. CSS-only animation. No portal — relies on `z-50` and document-level layering. Used by ServerRail and reusable elsewhere.

---

## Data flow

### Channel open

```
ChannelView mounts
  → useChannelMessages(channelId)
    → api.messages.history(channelId, { limit: 50 })
    → subscribes onMessageCreate/Update/Delete (filtered by channelId)
  → useGuildEmojis(currentGuildId)  (only if EmojiPicker open)
    → api.guilds.listEmojis(guildId)
    → subscribes onGuildEmojisUpdate (filtered by guildId)
```

### Live message arrives

```
discord.js Events.MessageCreate fires (main)
  → client-manager: project to MessageSummary, broadcast event.messageCreate
  → preload: forwards to renderer
  → useChannelMessages: if payload.channelId matches, append
    → MessageList: if scroll-near-bottom, smooth-scroll; else show jump pill
```

### Send message with attachments

```
Composer.submit
  → for each File: arrayBuffer() → Uint8Array
  → api.messages.sendWithAttachments(channelId, content, [{name, mimeType, bytes}])
  → ipc/messages.ts: builds AttachmentBuilder[], calls channel.send({content, files})
  → returns ok(MessageSummary)
  → discord.js Events.MessageCreate fires for our own message
  → live path appends it (no optimistic update needed for v1)
  → composer clears state
```

### Pagination (scroll up)

```
MessageList scroll handler: scrollTop < 200
  → useChannelMessages.loadOlder()
    → api.messages.history(channelId, { limit: 50, before: oldestId })
    → prepend; remember anchor element + its top offset
  → after layout: scrollTop += newAnchorTop - oldAnchorTop
```

---

## Error handling

| Scenario | Behavior |
|---|---|
| `messages.history` fails | Inline error banner above message list with retry button |
| Live event for unknown channel | Silently dropped (filter at hook level) |
| `sendWithAttachments` fails | Composer shows error toast (red), keeps content + attachments for retry |
| Attachment > 25MB | Rejected client-side before upload, toast |
| Gateway disconnects mid-session | Composer disabled with banner; live updates pause until `ready` |
| Custom emoji image 404 | Renders as fallback `:name:` text |
| Markdown parse error | Falls back to plain-text render of that segment |

---

## Testing

| File | What it covers |
|---|---|
| `lib/markdown.test.ts` | Parsing fixtures for every token type and several mixed cases |
| `lib/use-channel-messages.test.ts` | Append on create, ignore other channels, dedupe, paginate prepend |
| `lib/use-guild-emojis.test.ts` | Fetch + update on event |
| `EmojiPicker.test.tsx` | Both tabs render; onSelect emits correct token (`<:name:id>` vs unicode); search filters |
| `Composer.test.tsx` | Enter sends, Shift+Enter newline, files >25MB rejected with toast, disabled when gateway offline |

No new main-process tests — handlers are thin wrappers, and the existing IPC tests pattern doesn't cover discord.js calls that need a live client.

---

## File layout

**New renderer files:**
```
src/renderer/components/
  ServerRail.tsx
  CategoryGroup.tsx
  ChannelList.tsx              (rewritten)
  MessageList.tsx
  MessageGroup.tsx
  MessageContent.tsx
  Markdown.tsx
  EmbedCard.tsx
  AttachmentInline.tsx
  Composer.tsx
  AttachmentTray.tsx
  EmojiPicker.tsx
  Tooltip.tsx
src/renderer/lib/
  markdown.ts
  emoji-data.ts
  use-channel-messages.ts
  use-guild-emojis.ts
src/renderer/routes/shell/
  ChannelView.tsx              (new — hosts MessageList + Composer)
  ShellRoute.tsx               (rewritten layout)
```

**Modified main files:**
```
src/main/discord/client-manager.ts   (project richer MessageSummary, wire message events, wire emoji updates)
src/main/ipc/messages.ts             (sendWithAttachments handler)
src/main/ipc/guilds.ts               (listEmojis handler)
src/main/ipc/system.ts               (allowlist additions)
src/main/events/gateway-events.ts    (new event channel constants)
src/shared/domain.ts                 (extend MessageSummary, new types)
src/shared/ipc-contract.ts           (new methods + events)
src/preload/expose.ts                (new methods + events)
```

**Removed:**
```
src/renderer/components/GuildList.tsx   (replaced by ServerRail)
```

---

## Out of scope (tracked separately)

The following are explicitly deferred. See `docs/superpowers/followups/discord-shell-followups.md` for the prioritized list.

- Typing indicators
- Reactions (display + add)
- Reply-as-thread / message replies
- @-mention autocomplete in composer
- `:emoji:` autocomplete in composer
- Search, pinned messages, member list
- Voice channels
- Custom emoji upload
- Message edit/delete UI for own messages
- Syntax highlighting in code blocks
- Attachment preview for non-image types beyond filename pill
- Persistent collapsed-category state across launches (initial v1 stores in-memory; prefs persistence is a small follow-up)

---

## Verification

When done, the user can:

1. Launch app → see icon-only server rail with 1+ guilds, hover for tooltip.
2. Click a guild → see channel list grouped by category, click a chevron to collapse.
3. Click a channel → message history loads, 50 most recent visible, scrolled to bottom.
4. Scroll up → older messages load automatically and the scroll position stays anchored.
5. Type a message → click send (or Enter) → message appears in history.
6. Click paperclip → pick 2 files → see them in the tray → click send → both upload.
7. Drag 3 files onto the channel pane → see overlay → drop → files joined the tray.
8. Click emoji picker → switch to *Server* tab → see custom emoji → click one → token inserted in textarea.
9. While viewing a channel, post a message from a different client → the new message appears live.
10. While at top of history, post a new message from another client → "↓ jump to present (1 new)" pill appears.
