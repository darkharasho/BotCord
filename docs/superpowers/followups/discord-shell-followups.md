# Discord Shell — Follow-ups

Items deferred from the 2026-04-28 Discord-style shell rebuild. Roughly ordered by impact / effort ratio.

## High value, small effort

- **Persistent collapsed-category state.** v1 stores collapsed category ids in component memory; flush to `prefs` under a new key so layout survives app restart.
- **`:emoji:` autocomplete in composer.** Typing `:` opens an inline suggestion strip filtered by name. Reuses `useGuildEmojis` + `emoji-data.ts`. ~half day.
- **@-mention autocomplete.** Typing `@` opens a member-suggestion strip. Needs a new `members.search(guildId, query)` IPC backed by `guild.members.cache` + a fetch fallback.
- **Edit / delete UI for own messages.** IPC handlers already exist (`messages.delete`, and we'd add `messages.edit`). Just needs a hover-row action menu.

## Medium value

- **Reactions.** Display existing reactions (count + emoji + own reaction highlighted). Add new ones via a "+" button on hover. Needs `reactions.add`/`remove` IPC and `event.reactionUpdate` events.
- **Replies / threads.** Reply button on each message → composer header shows "Replying to {author}". `message.reply()` in main. Thread creation as a separate UI affordance.
- **Typing indicators.** `typingStart` gateway event → renderer shows "X is typing…" below message list.
- **Member list pane.** Optional right-side column listing guild members. Requires presence intent (already enabled).
- **Pinned messages.** Header dropdown showing pinned messages for the current channel.
- **Channel search.** Discord-style search bar over message content for the active channel.

## Polish

- **Syntax highlighting in code blocks.** Add `shiki` or `highlight.js` to `Markdown.tsx` (~150KB hit; use lazy import).
- **Attachment previews for non-image types.** Audio player for audio attachments; iframe-isolated PDF preview for PDFs.
- **Voice channels.** Out of scope for an admin cockpit but technically supported by discord.js.
- **Custom emoji upload.** Drag image into the emoji picker → upload via discord.js. Needs `Manage Emoji` permission.
- **Message animation polish.** Subtle fade-in for live-arriving messages, slide-out for deletes.

## Tech debt to revisit

- The `SendableChannel` structural type in `src/main/ipc/messages.ts` works around discord.js v14's `TextBasedChannel` including `PartialGroupDMChannel`. Worth replacing with `client.channels.fetch(...).isTextBased() && !ch.isDMBased()` once we exercise more channel types.
- `coerceChannel()` in `client-manager.ts` exists because gateway channel events can deliver `DMChannel` shapes. Once we narrow to guild-only event handling, drop the coercion.
- Renderer markdown parser (`lib/markdown.ts`) is hand-rolled. If our subset coverage drifts behind real Discord, switch to a fork of `simple-markdown` (which Discord originally derived their parser from).
