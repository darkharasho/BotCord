# Discord-Style Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the BotCord shell to look and feel like Discord — icon-only server rail, collapsible channel list, live message history with infinite scroll, and a chat composer with multi-file attachments and an emoji picker (unicode + custom guild).

**Architecture:** All visible work happens in the renderer. The main process gains four new gateway-event broadcasts (`messageCreate/Update/Delete`, `guildEmojisUpdate`), one new send IPC (`messages.sendWithAttachments`), and one new fetch IPC (`guilds.listEmojis`). MessageSummary expands with author avatar, attachments, embeds, and resolved mentions so the renderer can display Discord-shaped messages without round-trips. Markdown parsing is a hand-rolled subset parser; emoji data is a small static dataset. No new heavy npm dependencies.

**Tech Stack:** Existing — Electron + React 18 + TypeScript (strict), discord.js v14, Tailwind, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-04-28-discord-shell-design.md`
**Followups:** `docs/superpowers/followups/discord-shell-followups.md`

---

## Phase 0 — Engineer notes

- All paths relative to repo root. Use `npm` (the project uses npm even though some older docs say pnpm).
- Each task ends with a commit. The working tree should be clean between tasks.
- Some tasks need you to launch the app and click around. The dev command is `npm run dev`. If `better-sqlite3` complains about NODE_MODULE_VERSION, run `npm rebuild better-sqlite3` (the postinstall hook normally does this).
- Live discord.js behavior cannot be unit tested without a real bot — verification for those tasks is "smoke test in the running app" and a typecheck.
- The existing `MessageSummary` type is used by `messages.history` and `messages.send` IPC paths; extending it is a breaking change to the renderer call sites that touch it. There are currently no renderer call sites for messages — only the new code in this plan will consume them, so no migration is required.

---

## Task 1: Domain extensions for richer messages

**Files:**
- Modify: `src/shared/domain.ts`

- [ ] **Step 1: Add new domain types and extend MessageSummary**

Replace the `MessageSummary`, add `MessageAttachment`, `MessageEmbedSummary`, `ResolvedMention`, `GuildEmoji`, and add `collapsedCategoryIds` to `Prefs`. Final file:

```ts
export type GuildSummary = {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number | null;
};

export type ChannelKind =
  | 'text' | 'announcement' | 'forum' | 'voice' | 'category' | 'thread' | 'other';

export type ChannelSummary = {
  id: string;
  guildId: string;
  name: string;
  type: ChannelKind;
  parentId: string | null;
  position: number;
  topic: string | null;
};

export type MessageAttachment = {
  id: string;
  name: string;
  url: string;
  size: number;
  contentType: string | null;
  width: number | null;
  height: number | null;
};

export type MessageEmbedSummary = {
  title: string | null;
  description: string | null;
  url: string | null;
  color: number | null;
  image: string | null;
  thumbnail: string | null;
  authorName: string | null;
  footerText: string | null;
  fields: Array<{ name: string; value: string; inline: boolean }>;
};

export type ResolvedMention = { type: 'user' | 'channel' | 'role'; id: string; name: string };

export type GuildEmoji = {
  id: string;
  name: string;
  animated: boolean;
  guildId: string;
  url: string;
};

export type MessageSummary = {
  id: string;
  channelId: string;
  authorId: string;
  authorTag: string;
  authorAvatarUrl: string | null;
  content: string;
  createdAt: number;
  editedAt: number | null;
  hasEmbeds: boolean;
  hasAttachments: boolean;
  attachments: MessageAttachment[];
  embeds: MessageEmbedSummary[];
  mentions: ResolvedMention[];
  replyTo: { id: string; authorTag: string } | null;
};

export type EmbedPayload = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  footer?: { text: string; iconUrl?: string };
  author?: { name: string; url?: string; iconUrl?: string };
  thumbnail?: { url: string };
  image?: { url: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
};

export type BotIdentity = {
  id: string;
  username: string;
  discriminator: string;
  avatarUrl: string | null;
};

export type GatewayState =
  | { status: 'connecting' }
  | { status: 'ready'; sessionStartedAt: number }
  | { status: 'reconnecting'; attempt: number; lastError: string | null }
  | { status: 'disconnected'; reason: string | null };

export type BotStatus =
  | { kind: 'unconfigured' }
  | { kind: 'configured'; identity: BotIdentity; gateway: GatewayState };

export type DraftRow = {
  id: string;
  name: string;
  guildId: string | null;
  channelId: string | null;
  content: string | null;
  embed: EmbedPayload | null;
  createdAt: number;
  updatedAt: number;
};

export type DraftInput = Omit<DraftRow, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export type Prefs = {
  lastSelectedGuildId: string | null;
  lastSelectedChannelId: string | null;
  theme: 'dark';
  collapsedCategoryIds: string[];
};

export type SendAttachment = {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (No call sites use the new MessageSummary fields yet, so this just validates types.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(domain): extend MessageSummary with avatar/attachments/embeds/mentions"
```

---

## Task 2: IPC contract — new methods and events

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/events/gateway-events.ts`

- [ ] **Step 1: Extend `BotcordApi` and `IPC_CHANNELS`**

Replace `src/shared/ipc-contract.ts`:

```ts
import type {
  BotIdentity, BotStatus, ChannelSummary, DraftInput, DraftRow,
  EmbedPayload, GatewayState, GuildEmoji, GuildSummary, MessageSummary, Prefs, SendAttachment,
} from './domain';
import type { Result } from './errors';

export interface BotcordApi {
  bot: {
    getStatus(): Promise<BotStatus>;
    validateToken(token: string): Promise<Result<BotIdentity>>;
    saveToken(token: string): Promise<Result<BotIdentity>>;
    clearToken(): Promise<Result<void>>;
    buildInviteUrl(clientId: string): Promise<Result<string>>;
  };
  guilds: {
    list(): Promise<Result<GuildSummary[]>>;
    listChannels(guildId: string): Promise<Result<ChannelSummary[]>>;
    listEmojis(guildId: string): Promise<Result<GuildEmoji[]>>;
  };
  messages: {
    send(channelId: string, content: string): Promise<Result<MessageSummary>>;
    sendEmbed(channelId: string, embed: EmbedPayload, content?: string): Promise<Result<MessageSummary>>;
    sendWithAttachments(
      channelId: string,
      content: string,
      attachments: SendAttachment[],
    ): Promise<Result<MessageSummary>>;
    history(channelId: string, opts: { before?: string; limit: number }): Promise<Result<MessageSummary[]>>;
    delete(channelId: string, messageId: string): Promise<Result<void>>;
    bulkDelete(channelId: string, messageIds: string[]): Promise<Result<{ deleted: string[] }>>;
  };
  drafts: {
    list(): Promise<Result<DraftRow[]>>;
    upsert(draft: DraftInput): Promise<Result<DraftRow>>;
    delete(id: string): Promise<Result<void>>;
  };
  prefs: {
    get<K extends keyof Prefs>(key: K): Promise<Result<Prefs[K]>>;
    set<K extends keyof Prefs>(key: K, value: Prefs[K]): Promise<Result<void>>;
  };
  events: {
    onBotStatus(cb: (s: BotStatus) => void): () => void;
    onGatewayState(cb: (s: GatewayState) => void): () => void;
    onGuildUpdate(cb: (g: GuildSummary) => void): () => void;
    onChannelUpdate(cb: (c: ChannelSummary) => void): () => void;
    onMessageCreate(cb: (p: { channelId: string; message: MessageSummary }) => void): () => void;
    onMessageUpdate(cb: (p: { channelId: string; message: MessageSummary }) => void): () => void;
    onMessageDelete(cb: (p: { channelId: string; messageId: string }) => void): () => void;
    onGuildEmojisUpdate(cb: (p: { guildId: string; emojis: GuildEmoji[] }) => void): () => void;
  };
  system: {
    appVersion(): Promise<string>;
    openExternal(url: string): Promise<void>;
  };
}

export const IPC_CHANNELS = {
  'bot.getStatus': 'bot.getStatus',
  'bot.validateToken': 'bot.validateToken',
  'bot.saveToken': 'bot.saveToken',
  'bot.clearToken': 'bot.clearToken',
  'bot.buildInviteUrl': 'bot.buildInviteUrl',
  'guilds.list': 'guilds.list',
  'guilds.listChannels': 'guilds.listChannels',
  'guilds.listEmojis': 'guilds.listEmojis',
  'messages.send': 'messages.send',
  'messages.sendEmbed': 'messages.sendEmbed',
  'messages.sendWithAttachments': 'messages.sendWithAttachments',
  'messages.history': 'messages.history',
  'messages.delete': 'messages.delete',
  'messages.bulkDelete': 'messages.bulkDelete',
  'drafts.list': 'drafts.list',
  'drafts.upsert': 'drafts.upsert',
  'drafts.delete': 'drafts.delete',
  'prefs.get': 'prefs.get',
  'prefs.set': 'prefs.set',
  'system.appVersion': 'system.appVersion',
  'system.openExternal': 'system.openExternal',
  'event.botStatus': 'event.botStatus',
  'event.gatewayState': 'event.gatewayState',
  'event.guildUpdate': 'event.guildUpdate',
  'event.channelUpdate': 'event.channelUpdate',
  'event.messageCreate': 'event.messageCreate',
  'event.messageUpdate': 'event.messageUpdate',
  'event.messageDelete': 'event.messageDelete',
  'event.guildEmojisUpdate': 'event.guildEmojisUpdate',
} as const;

export type IpcChannel = keyof typeof IPC_CHANNELS;

declare global {
  interface Window {
    botcord: BotcordApi;
  }
}
```

- [ ] **Step 2: Add channel constants in `src/main/events/gateway-events.ts`**

Append after the existing constants:

```ts
export const MESSAGE_CREATE_CHANNEL = IPC_CHANNELS['event.messageCreate'];
export const MESSAGE_UPDATE_CHANNEL = IPC_CHANNELS['event.messageUpdate'];
export const MESSAGE_DELETE_CHANNEL = IPC_CHANNELS['event.messageDelete'];
export const GUILD_EMOJIS_UPDATE_CHANNEL = IPC_CHANNELS['event.guildEmojisUpdate'];
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: FAIL — preload `expose.ts` and main `ipc/messages.ts` haven't been updated. That's expected; subsequent tasks fix.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ipc): contract additions for live messages, attachments, and emojis"
```

---

## Task 3: Preload bridge — wire new methods and events

**Files:**
- Modify: `src/preload/expose.ts`

- [ ] **Step 1: Add the new method/event wirings**

Replace the file:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-contract';
import type { BotcordApi } from '../shared/ipc-contract';

const invoke = <T>(channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const subscribe = (channel: string, cb: (payload: unknown) => void): (() => void) => {
  const handler = (_: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const api: BotcordApi = {
  bot: {
    getStatus: () => invoke(IPC_CHANNELS['bot.getStatus']),
    validateToken: (token) => invoke(IPC_CHANNELS['bot.validateToken'], token),
    saveToken: (token) => invoke(IPC_CHANNELS['bot.saveToken'], token),
    clearToken: () => invoke(IPC_CHANNELS['bot.clearToken']),
    buildInviteUrl: (clientId) => invoke(IPC_CHANNELS['bot.buildInviteUrl'], clientId),
  },
  guilds: {
    list: () => invoke(IPC_CHANNELS['guilds.list']),
    listChannels: (guildId) => invoke(IPC_CHANNELS['guilds.listChannels'], guildId),
    listEmojis: (guildId) => invoke(IPC_CHANNELS['guilds.listEmojis'], guildId),
  },
  messages: {
    send: (channelId, content) => invoke(IPC_CHANNELS['messages.send'], channelId, content),
    sendEmbed: (channelId, embed, content) =>
      invoke(IPC_CHANNELS['messages.sendEmbed'], channelId, embed, content),
    sendWithAttachments: (channelId, content, attachments) =>
      invoke(IPC_CHANNELS['messages.sendWithAttachments'], channelId, content, attachments),
    history: (channelId, opts) => invoke(IPC_CHANNELS['messages.history'], channelId, opts),
    delete: (channelId, messageId) => invoke(IPC_CHANNELS['messages.delete'], channelId, messageId),
    bulkDelete: (channelId, ids) => invoke(IPC_CHANNELS['messages.bulkDelete'], channelId, ids),
  },
  drafts: {
    list: () => invoke(IPC_CHANNELS['drafts.list']),
    upsert: (draft) => invoke(IPC_CHANNELS['drafts.upsert'], draft),
    delete: (id) => invoke(IPC_CHANNELS['drafts.delete'], id),
  },
  prefs: {
    get: (key) => invoke(IPC_CHANNELS['prefs.get'], key),
    set: (key, value) => invoke(IPC_CHANNELS['prefs.set'], key, value),
  },
  events: {
    onBotStatus: (cb) => subscribe(IPC_CHANNELS['event.botStatus'], cb as (p: unknown) => void),
    onGatewayState: (cb) => subscribe(IPC_CHANNELS['event.gatewayState'], cb as (p: unknown) => void),
    onGuildUpdate: (cb) => subscribe(IPC_CHANNELS['event.guildUpdate'], cb as (p: unknown) => void),
    onChannelUpdate: (cb) => subscribe(IPC_CHANNELS['event.channelUpdate'], cb as (p: unknown) => void),
    onMessageCreate: (cb) => subscribe(IPC_CHANNELS['event.messageCreate'], cb as (p: unknown) => void),
    onMessageUpdate: (cb) => subscribe(IPC_CHANNELS['event.messageUpdate'], cb as (p: unknown) => void),
    onMessageDelete: (cb) => subscribe(IPC_CHANNELS['event.messageDelete'], cb as (p: unknown) => void),
    onGuildEmojisUpdate: (cb) => subscribe(IPC_CHANNELS['event.guildEmojisUpdate'], cb as (p: unknown) => void),
  },
  system: {
    appVersion: () => invoke(IPC_CHANNELS['system.appVersion']),
    openExternal: (url) => invoke(IPC_CHANNELS['system.openExternal'], url),
  },
};

contextBridge.exposeInMainWorld('botcord', api);
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: still FAIL — main IPC handlers not yet updated. Subsequent tasks fix.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(preload): expose live message and emoji APIs"
```

---

## Task 4: Client manager — richer projection + new gateway events

**Files:**
- Modify: `src/main/discord/client-manager.ts`

- [ ] **Step 1: Add a `summarizeMessage` helper**

Inside `src/main/discord/client-manager.ts`, after the existing imports, add:

```ts
import type { Message } from 'discord.js';
import type { MessageSummary, MessageAttachment, MessageEmbedSummary, ResolvedMention, GuildEmoji } from '../../shared/domain';
```

Then near the bottom of the file (after `coerceChannel` / `mapType`), add:

```ts
export function summarizeMessage(m: Message): MessageSummary {
  const attachments: MessageAttachment[] = m.attachments.map(a => ({
    id: a.id,
    name: a.name ?? 'file',
    url: a.url,
    size: a.size,
    contentType: a.contentType ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
  }));

  const embeds: MessageEmbedSummary[] = m.embeds.map(e => ({
    title: e.title ?? null,
    description: e.description ?? null,
    url: e.url ?? null,
    color: e.color ?? null,
    image: e.image?.url ?? null,
    thumbnail: e.thumbnail?.url ?? null,
    authorName: e.author?.name ?? null,
    footerText: e.footer?.text ?? null,
    fields: e.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline ?? false })),
  }));

  const mentions: ResolvedMention[] = [];
  m.mentions.users.forEach(u => mentions.push({ type: 'user', id: u.id, name: u.username }));
  m.mentions.channels.forEach(c => mentions.push({ type: 'channel', id: c.id, name: 'name' in c && typeof c.name === 'string' ? c.name : 'channel' }));
  m.mentions.roles.forEach(r => mentions.push({ type: 'role', id: r.id, name: r.name }));

  return {
    id: m.id,
    channelId: m.channelId,
    authorId: m.author.id,
    authorTag: `${m.author.username}${m.author.discriminator && m.author.discriminator !== '0' ? '#' + m.author.discriminator : ''}`,
    authorAvatarUrl: m.author.displayAvatarURL({ size: 64 }),
    content: m.content,
    createdAt: m.createdTimestamp,
    editedAt: m.editedTimestamp,
    hasEmbeds: embeds.length > 0,
    hasAttachments: attachments.length > 0,
    attachments,
    embeds,
    mentions,
    replyTo: m.reference?.messageId
      ? { id: m.reference.messageId, authorTag: '' /* not resolved without an extra fetch */ }
      : null,
  };
}

export function projectGuildEmojis(guildId: string, emojis: Iterable<{ id: string | null; name: string | null; animated: boolean | null }>): GuildEmoji[] {
  const out: GuildEmoji[] = [];
  for (const e of emojis) {
    if (!e.id || !e.name) continue;
    out.push({
      id: e.id,
      name: e.name,
      animated: e.animated ?? false,
      guildId,
      url: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}`,
    });
  }
  return out;
}
```

- [ ] **Step 2: Wire the new gateway events**

Find `wireEvents(c)` in `client-manager.ts`. Add these listeners at the end of the function body (before its closing `}`):

```ts
    c.on(Events.MessageCreate, (m) => {
      broadcast(MESSAGE_CREATE_CHANNEL, { channelId: m.channelId, message: summarizeMessage(m) });
    });
    c.on(Events.MessageUpdate, (_old, mNew) => {
      // mNew may be a partial; fetch to get full message
      if (mNew.partial) {
        mNew.fetch().then(full => {
          broadcast(MESSAGE_UPDATE_CHANNEL, { channelId: full.channelId, message: summarizeMessage(full) });
        }).catch(() => { /* ignore */ });
        return;
      }
      broadcast(MESSAGE_UPDATE_CHANNEL, { channelId: mNew.channelId, message: summarizeMessage(mNew) });
    });
    c.on(Events.MessageDelete, (m) => {
      broadcast(MESSAGE_DELETE_CHANNEL, { channelId: m.channelId, messageId: m.id });
    });
    c.on(Events.GuildEmojiCreate, (e) => {
      const guild = e.guild;
      broadcast(GUILD_EMOJIS_UPDATE_CHANNEL, { guildId: guild.id, emojis: projectGuildEmojis(guild.id, guild.emojis.cache.values()) });
    });
    c.on(Events.GuildEmojiDelete, (e) => {
      const guild = e.guild;
      broadcast(GUILD_EMOJIS_UPDATE_CHANNEL, { guildId: guild.id, emojis: projectGuildEmojis(guild.id, guild.emojis.cache.values()) });
    });
    c.on(Events.GuildEmojiUpdate, (_old, eNew) => {
      const guild = eNew.guild;
      broadcast(GUILD_EMOJIS_UPDATE_CHANNEL, { guildId: guild.id, emojis: projectGuildEmojis(guild.id, guild.emojis.cache.values()) });
    });
```

- [ ] **Step 3: Update the broadcast import block**

At the top of `client-manager.ts`, in the `import { ... } from '../events/gateway-events'` block, add the four new constants:

```ts
import {
  broadcast,
  BOT_STATUS_CHANNEL,
  GATEWAY_EVENT_CHANNEL,
  GUILD_UPDATE_CHANNEL,
  CHANNEL_UPDATE_CHANNEL,
  MESSAGE_CREATE_CHANNEL,
  MESSAGE_UPDATE_CHANNEL,
  MESSAGE_DELETE_CHANNEL,
  GUILD_EMOJIS_UPDATE_CHANNEL,
} from '../events/gateway-events';
```

- [ ] **Step 4: Enable partials so MessageDelete fires for uncached messages**

At the top of `client-manager.ts`, change the discord.js import to include `Partials`:

```ts
import { Client, Events, Partials } from 'discord.js';
```

Find the `new Client({ intents: REQUIRED_INTENTS })` line in the `connect` method and replace it with:

```ts
client = new Client({
  intents: REQUIRED_INTENTS,
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.Reaction],
});
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS for `tsconfig.node.json`. Renderer typecheck may still complain about missing handlers — that's OK until Task 5.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(discord): broadcast message + emoji gateway events with rich projections"
```

---

## Task 5: Main IPC — sendWithAttachments + listEmojis + allowlist

**Files:**
- Modify: `src/main/ipc/messages.ts`
- Modify: `src/main/ipc/guilds.ts`
- Modify: `src/main/ipc/system.ts`

- [ ] **Step 1: Replace `src/main/ipc/messages.ts`**

```ts
import { ipcMain } from 'electron';
import { EmbedBuilder, AttachmentBuilder, type Message } from 'discord.js';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { EmbedPayload, MessageSummary, SendAttachment } from '../../shared/domain';
import { summarizeMessage } from '../discord/client-manager';
import type { IpcDeps } from './index';

type SendableChannel = {
  send: (opts: { content?: string | undefined; embeds?: EmbedBuilder[]; files?: AttachmentBuilder[] }) => Promise<Message>;
  messages: {
    fetch: ((opts: { limit: number; before?: string }) => Promise<Map<string, Message>>) &
           ((id: string) => Promise<Message>);
  };
  bulkDelete?: (ids: string[], filterOld?: boolean) => Promise<Map<string, Message>>;
};

const buildEmbed = (p: EmbedPayload): EmbedBuilder => {
  const e = new EmbedBuilder();
  if (p.title) e.setTitle(p.title);
  if (p.description) e.setDescription(p.description);
  if (p.url) e.setURL(p.url);
  if (typeof p.color === 'number') e.setColor(p.color);
  if (p.timestamp) e.setTimestamp(new Date(p.timestamp));
  if (p.footer) e.setFooter(p.footer.iconUrl ? { text: p.footer.text, iconURL: p.footer.iconUrl } : { text: p.footer.text });
  if (p.author) {
    const a: { name: string; url?: string; iconURL?: string } = { name: p.author.name };
    if (p.author.url) a.url = p.author.url;
    if (p.author.iconUrl) a.iconURL = p.author.iconUrl;
    e.setAuthor(a);
  }
  if (p.thumbnail) e.setThumbnail(p.thumbnail.url);
  if (p.image) e.setImage(p.image.url);
  if (p.fields?.length) e.addFields(p.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline ?? false })));
  return e;
};

export function registerMessageHandlers({ manager }: IpcDeps): void {
  const requireSendableChannel = async (channelId: string): Promise<{ ok: true; channel: SendableChannel } | Result<never>> => {
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || !('send' in ch) || typeof (ch as SendableChannel).send !== 'function') {
      return err('NOT_FOUND', `Channel ${channelId} is not a sendable text channel`);
    }
    return { ok: true, channel: ch as SendableChannel };
  };

  ipcMain.handle(IPC_CHANNELS['messages.send'], async (_, channelId: unknown, content: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof content !== 'string') return err('INTERNAL', 'invalid arguments');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    try {
      const msg = await (got as { ok: true; channel: SendableChannel }).channel.send({ content });
      return ok(summarizeMessage(msg));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.sendEmbed'], async (_, channelId: unknown, embed: unknown, content?: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof embed !== 'object' || embed === null) return err('INTERNAL', 'invalid arguments');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    try {
      const msg = await (got as { ok: true; channel: SendableChannel }).channel.send({
        content: typeof content === 'string' ? content : undefined,
        embeds: [buildEmbed(embed as EmbedPayload)],
      });
      return ok(summarizeMessage(msg));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.sendWithAttachments'], async (_, channelId: unknown, content: unknown, attachments: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof content !== 'string' || !Array.isArray(attachments)) {
      return err('INTERNAL', 'invalid arguments');
    }
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;

    let files: AttachmentBuilder[];
    try {
      files = (attachments as SendAttachment[]).map((a, i) => {
        if (typeof a?.name !== 'string' || !(a.bytes instanceof Uint8Array)) {
          throw new Error(`attachments[${i}] is malformed`);
        }
        const buffer = Buffer.from(a.bytes);
        return new AttachmentBuilder(buffer, { name: a.name });
      });
    } catch (e) {
      return err('INTERNAL', e instanceof Error ? e.message : String(e));
    }

    try {
      const msg = await (got as { ok: true; channel: SendableChannel }).channel.send({
        content: content.length > 0 ? content : undefined,
        files,
      });
      return ok(summarizeMessage(msg));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.history'], async (_, channelId: unknown, opts: unknown): Promise<Result<MessageSummary[]>> => {
    if (typeof channelId !== 'string' || typeof opts !== 'object' || opts === null) return err('INTERNAL', 'invalid arguments');
    const o = opts as { before?: string; limit: number };
    if (typeof o.limit !== 'number' || o.limit < 1 || o.limit > 100) return err('INTERNAL', 'limit must be 1-100');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary[]>;
    try {
      const fetchOpts: { limit: number; before?: string } = { limit: o.limit };
      if (o.before) fetchOpts.before = o.before;
      const messages = await (got as { ok: true; channel: SendableChannel }).channel.messages.fetch(fetchOpts);
      return ok(Array.from(messages.values()).map(summarizeMessage));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.delete'], async (_, channelId: unknown, messageId: unknown): Promise<Result<void>> => {
    if (typeof channelId !== 'string' || typeof messageId !== 'string') return err('INTERNAL', 'invalid arguments');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<void>;
    try {
      const msg = await (got as { ok: true; channel: SendableChannel }).channel.messages.fetch(messageId);
      await msg.delete();
      return ok(undefined);
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.bulkDelete'], async (_, channelId: unknown, messageIds: unknown): Promise<Result<{ deleted: string[] }>> => {
    if (typeof channelId !== 'string' || !Array.isArray(messageIds)) return err('INTERNAL', 'invalid arguments');
    const ids = messageIds.filter((v): v is string => typeof v === 'string');
    if (ids.length === 0) return ok({ deleted: [] });
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<{ deleted: string[] }>;
    const channel = (got as { ok: true; channel: SendableChannel }).channel;
    if (!channel.bulkDelete) {
      return err('MISSING_PERMISSIONS', 'Channel does not support bulk delete');
    }
    try {
      const result = await channel.bulkDelete(ids, true);
      return ok({ deleted: Array.from(result.keys()) });
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });
}
```

- [ ] **Step 2: Add `guilds.listEmojis` handler in `src/main/ipc/guilds.ts`**

Append (before the final `}` of `registerGuildHandlers`):

```ts
  ipcMain.handle(IPC_CHANNELS['guilds.listEmojis'], async (_, guildId: unknown): Promise<Result<GuildEmoji[]>> => {
    if (typeof guildId !== 'string') return err('INTERNAL', 'guildId must be a string');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);
    return ok(projectGuildEmojis(guild.id, guild.emojis.cache.values()));
  });
```

And update the imports at the top:

```ts
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { GuildSummary, ChannelSummary, GuildEmoji } from '../../shared/domain';
import { projectChannel, projectGuildEmojis } from '../discord/client-manager';
import type { IpcDeps } from './index';
```

- [ ] **Step 3: Extend allowlist in `src/main/ipc/system.ts`**

Replace the `ALLOWED_PREFIXES` array:

```ts
const ALLOWED_PREFIXES = [
  'https://discord.com/',
  'https://cdn.discordapp.com/',
  'https://discordapp.com/',
  'https://media.discordapp.net/',
];
```

(`https://cdn.discordapp.com/` already covers attachments, so no further additions needed.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run existing tests to confirm no regressions**

Run: `npm test`
Expected: PASS, all 16 existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ipc): sendWithAttachments, listEmojis, allowlist for media.discordapp.net"
```

---

## Task 6: CSP — allow images from Discord CDN media domain

**Files:**
- Modify: `src/main/security/csp.ts`

- [ ] **Step 1: Add the CDN media subdomain to img-src in both CSPs**

Change every `img-src` line in `src/main/security/csp.ts` from:

```
"img-src 'self' https://cdn.discordapp.com data:",
```

to:

```
"img-src 'self' https://cdn.discordapp.com https://media.discordapp.net data:",
```

(Both PROD_CSP and DEV_CSP arrays.)

- [ ] **Step 2: Smoke test**

Run: `npm run dev`. In a real channel, post a message with an image attachment. Verify it renders in the BotCord app once Task 14 (MessageList wiring) is done. For now, just verify `npm run dev` launches without console errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix(csp): allow images from media.discordapp.net"
```

---

## Task 7: Markdown parser (TDD)

**Files:**
- Create: `src/renderer/lib/markdown.ts`
- Create: `src/renderer/lib/__tests__/markdown.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/renderer/lib/__tests__/markdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../markdown';

describe('parseMarkdown', () => {
  it('parses plain text as a single text token', () => {
    expect(parseMarkdown('hello world')).toEqual([{ type: 'text', value: 'hello world' }]);
  });

  it('parses bold with double-asterisk', () => {
    const out = parseMarkdown('a **bold** b');
    expect(out).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'bold', children: [{ type: 'text', value: 'bold' }] },
      { type: 'text', value: ' b' },
    ]);
  });

  it('parses italic with single underscore', () => {
    const out = parseMarkdown('_em_');
    expect(out).toEqual([{ type: 'italic', children: [{ type: 'text', value: 'em' }] }]);
  });

  it('parses strikethrough with double tilde', () => {
    expect(parseMarkdown('~~gone~~')).toEqual([
      { type: 'strike', children: [{ type: 'text', value: 'gone' }] },
    ]);
  });

  it('parses inline code with single backtick', () => {
    expect(parseMarkdown('use `npm test`')).toEqual([
      { type: 'text', value: 'use ' },
      { type: 'code_inline', value: 'npm test' },
    ]);
  });

  it('parses fenced code blocks with optional language', () => {
    expect(parseMarkdown('```ts\nconst x = 1;\n```')).toEqual([
      { type: 'code_block', lang: 'ts', value: 'const x = 1;' },
    ]);
  });

  it('parses spoilers with double pipe', () => {
    expect(parseMarkdown('||secret||')).toEqual([
      { type: 'spoiler', children: [{ type: 'text', value: 'secret' }] },
    ]);
  });

  it('parses blockquotes (lines starting with > )', () => {
    expect(parseMarkdown('> hi\n> there')).toEqual([
      { type: 'blockquote', children: [{ type: 'text', value: 'hi\nthere' }] },
    ]);
  });

  it('parses user mentions', () => {
    expect(parseMarkdown('hi <@123>')).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'mention_user', id: '123' },
    ]);
  });

  it('parses channel mentions', () => {
    expect(parseMarkdown('see <#456>')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'mention_channel', id: '456' },
    ]);
  });

  it('parses role mentions', () => {
    expect(parseMarkdown('<@&789>')).toEqual([{ type: 'mention_role', id: '789' }]);
  });

  it('parses custom emoji (static and animated)', () => {
    expect(parseMarkdown('<:fire:111>')).toEqual([
      { type: 'custom_emoji', name: 'fire', id: '111', animated: false },
    ]);
    expect(parseMarkdown('<a:dance:222>')).toEqual([
      { type: 'custom_emoji', name: 'dance', id: '222', animated: true },
    ]);
  });

  it('auto-links bare URLs', () => {
    expect(parseMarkdown('see https://example.com end')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'https://example.com' }] },
      { type: 'text', value: ' end' },
    ]);
  });

  it('preserves line breaks as line_break tokens', () => {
    expect(parseMarkdown('a\nb')).toEqual([
      { type: 'text', value: 'a' },
      { type: 'line_break' },
      { type: 'text', value: 'b' },
    ]);
  });

  it('handles mixed inline formatting', () => {
    expect(parseMarkdown('**bold _and italic_**')).toEqual([
      { type: 'bold', children: [
        { type: 'text', value: 'bold ' },
        { type: 'italic', children: [{ type: 'text', value: 'and italic' }] },
      ]},
    ]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run src/renderer/lib/__tests__/markdown.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/renderer/lib/markdown.ts`**

```ts
export type MdNode =
  | { type: 'text'; value: string }
  | { type: 'line_break' }
  | { type: 'bold'; children: MdNode[] }
  | { type: 'italic'; children: MdNode[] }
  | { type: 'strike'; children: MdNode[] }
  | { type: 'spoiler'; children: MdNode[] }
  | { type: 'code_inline'; value: string }
  | { type: 'code_block'; lang: string | null; value: string }
  | { type: 'blockquote'; children: MdNode[] }
  | { type: 'link'; url: string; children: MdNode[] }
  | { type: 'mention_user'; id: string }
  | { type: 'mention_channel'; id: string }
  | { type: 'mention_role'; id: string }
  | { type: 'custom_emoji'; name: string; id: string; animated: boolean };

export function parseMarkdown(input: string): MdNode[] {
  // Block pass: split out code blocks and blockquotes; recurse into inline for the rest.
  const out: MdNode[] = [];
  let i = 0;

  while (i < input.length) {
    // Code block
    if (input.startsWith('```', i)) {
      const end = input.indexOf('```', i + 3);
      if (end !== -1) {
        const inner = input.slice(i + 3, end);
        const nl = inner.indexOf('\n');
        const lang = nl >= 0 ? inner.slice(0, nl).trim() : '';
        const code = nl >= 0 ? inner.slice(nl + 1) : inner;
        out.push({ type: 'code_block', lang: lang.length > 0 ? lang : null, value: code.replace(/\n$/, '') });
        i = end + 3;
        continue;
      }
    }
    // Blockquote (one or more consecutive '> ' lines)
    if ((i === 0 || input[i - 1] === '\n') && input.startsWith('> ', i)) {
      const lines: string[] = [];
      while (i < input.length && input.startsWith('> ', i)) {
        const nl = input.indexOf('\n', i);
        const lineEnd = nl === -1 ? input.length : nl;
        lines.push(input.slice(i + 2, lineEnd));
        i = nl === -1 ? input.length : nl + 1;
      }
      out.push({ type: 'blockquote', children: parseInline(lines.join('\n')) });
      continue;
    }

    // Find next block boundary (start of next code block / blockquote / EOF)
    let nextBlock = input.length;
    const nextCode = input.indexOf('```', i);
    if (nextCode !== -1 && nextCode < nextBlock) nextBlock = nextCode;
    let bq = input.indexOf('\n> ', i);
    if (bq !== -1 && bq + 1 < nextBlock) nextBlock = bq + 1;
    if (i === 0 && input.startsWith('> ')) nextBlock = i;

    const segment = input.slice(i, nextBlock);
    if (segment.length > 0) out.push(...parseInline(segment));
    i = nextBlock;
  }

  return out;
}

function parseInline(text: string): MdNode[] {
  // Tokens we look for: line breaks, mentions, custom emoji, URLs, inline code, bold, italic, strike, spoiler.
  const out: MdNode[] = [];
  let i = 0;
  let buf = '';
  const flushBuf = () => { if (buf.length > 0) { out.push({ type: 'text', value: buf }); buf = ''; } };

  while (i < text.length) {
    const c = text[i]!;

    // Line break
    if (c === '\n') { flushBuf(); out.push({ type: 'line_break' }); i++; continue; }

    // Inline code (backticks, simple — no escaping inside)
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        flushBuf();
        out.push({ type: 'code_inline', value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Custom emoji <a?:name:id>
    if (c === '<') {
      const emojiMatch = /^<(a?):([A-Za-z0-9_]+):(\d+)>/.exec(text.slice(i));
      if (emojiMatch) {
        flushBuf();
        out.push({ type: 'custom_emoji', name: emojiMatch[2]!, id: emojiMatch[3]!, animated: emojiMatch[1] === 'a' });
        i += emojiMatch[0].length;
        continue;
      }
      const userMatch = /^<@!?(\d+)>/.exec(text.slice(i));
      if (userMatch) {
        flushBuf();
        out.push({ type: 'mention_user', id: userMatch[1]! });
        i += userMatch[0].length;
        continue;
      }
      const channelMatch = /^<#(\d+)>/.exec(text.slice(i));
      if (channelMatch) {
        flushBuf();
        out.push({ type: 'mention_channel', id: channelMatch[1]! });
        i += channelMatch[0].length;
        continue;
      }
      const roleMatch = /^<@&(\d+)>/.exec(text.slice(i));
      if (roleMatch) {
        flushBuf();
        out.push({ type: 'mention_role', id: roleMatch[1]! });
        i += roleMatch[0].length;
        continue;
      }
    }

    // URL auto-link (http/https only)
    if ((c === 'h') && (text.startsWith('https://', i) || text.startsWith('http://', i))) {
      const m = /^https?:\/\/[^\s<>]+/.exec(text.slice(i));
      if (m) {
        flushBuf();
        out.push({ type: 'link', url: m[0], children: [{ type: 'text', value: m[0] }] });
        i += m[0].length;
        continue;
      }
    }

    // Paired delimiters: **bold**, __also-bold__, *italic*, _italic_, ~~strike~~, ||spoiler||
    const pairs: Array<{ open: string; close: string; type: 'bold' | 'italic' | 'strike' | 'spoiler' }> = [
      { open: '**', close: '**', type: 'bold' },
      { open: '__', close: '__', type: 'bold' },
      { open: '~~', close: '~~', type: 'strike' },
      { open: '||', close: '||', type: 'spoiler' },
      { open: '*', close: '*', type: 'italic' },
      { open: '_', close: '_', type: 'italic' },
    ];
    let matched = false;
    for (const p of pairs) {
      if (text.startsWith(p.open, i)) {
        const close = text.indexOf(p.close, i + p.open.length);
        if (close !== -1 && close > i + p.open.length) {
          flushBuf();
          const inner = text.slice(i + p.open.length, close);
          out.push({ type: p.type, children: parseInline(inner) });
          i = close + p.close.length;
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;

    buf += c;
    i++;
  }
  flushBuf();
  return out;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/renderer/lib/__tests__/markdown.test.ts`
Expected: PASS, all 15 cases.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(markdown): discord-subset markdown parser with tests"
```

---

## Task 8: Markdown renderer component

**Files:**
- Create: `src/renderer/components/Markdown.tsx`

- [ ] **Step 1: Implement the renderer**

```tsx
import type { MdNode } from '../lib/markdown';
import { parseMarkdown } from '../lib/markdown';
import type { ResolvedMention } from '../../shared/domain';
import { useState, type ReactNode } from 'react';

type Props = {
  source: string;
  mentions?: ResolvedMention[];
};

export function Markdown({ source, mentions = [] }: Props) {
  const tree = parseMarkdown(source);
  return <span>{tree.map((n, i) => renderNode(n, i, mentions))}</span>;
}

function renderNode(n: MdNode, key: number, mentions: ResolvedMention[]): ReactNode {
  switch (n.type) {
    case 'text': return <span key={key}>{n.value}</span>;
    case 'line_break': return <br key={key} />;
    case 'bold': return <strong key={key}>{n.children.map((c, i) => renderNode(c, i, mentions))}</strong>;
    case 'italic': return <em key={key}>{n.children.map((c, i) => renderNode(c, i, mentions))}</em>;
    case 'strike': return <s key={key}>{n.children.map((c, i) => renderNode(c, i, mentions))}</s>;
    case 'spoiler': return <Spoiler key={key}>{n.children.map((c, i) => renderNode(c, i, mentions))}</Spoiler>;
    case 'code_inline':
      return <code key={key} className="bg-bg-sunken px-1 py-0.5 rounded text-xs font-mono">{n.value}</code>;
    case 'code_block':
      return (
        <pre key={key} className="bg-bg-sunken border border-border rounded p-3 my-1 overflow-x-auto text-xs font-mono">
          <code>{n.value}</code>
        </pre>
      );
    case 'blockquote':
      return (
        <blockquote key={key} className="border-l-4 border-border pl-3 my-1">
          {n.children.map((c, i) => renderNode(c, i, mentions))}
        </blockquote>
      );
    case 'link':
      return (
        <a key={key} href={n.url} className="text-accent hover:underline" onClick={(e) => {
          e.preventDefault();
          window.botcord.system.openExternal(n.url);
        }}>
          {n.children.map((c, i) => renderNode(c, i, mentions))}
        </a>
      );
    case 'mention_user': {
      const m = mentions.find(x => x.type === 'user' && x.id === n.id);
      return <span key={key} className="bg-accent/20 text-accent rounded px-1">@{m?.name ?? n.id}</span>;
    }
    case 'mention_channel': {
      const m = mentions.find(x => x.type === 'channel' && x.id === n.id);
      return <span key={key} className="bg-accent/20 text-accent rounded px-1">#{m?.name ?? n.id}</span>;
    }
    case 'mention_role': {
      const m = mentions.find(x => x.type === 'role' && x.id === n.id);
      return <span key={key} className="bg-accent/20 text-accent rounded px-1">@{m?.name ?? n.id}</span>;
    }
    case 'custom_emoji': {
      const ext = n.animated ? 'gif' : 'png';
      return (
        <img
          key={key}
          src={`https://cdn.discordapp.com/emojis/${n.id}.${ext}`}
          alt={`:${n.name}:`}
          title={`:${n.name}:`}
          className="inline-block w-5 h-5 align-text-bottom"
          onError={(e) => { (e.currentTarget as HTMLImageElement).replaceWith(document.createTextNode(`:${n.name}:`)); }}
        />
      );
    }
  }
}

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => setRevealed(true)}
      className={`rounded px-1 cursor-pointer ${revealed ? 'bg-bg-sunken' : 'bg-fg text-bg select-none'}`}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(markdown): React renderer for parsed markdown tree"
```

---

## Task 9: Tooltip primitive

**Files:**
- Create: `src/renderer/components/Tooltip.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState, type ReactNode } from 'react';

type Props = {
  label: string;
  side?: 'right' | 'top' | 'bottom';
  children: ReactNode;
};

export function Tooltip({ label, side = 'right', children }: Props) {
  const [show, setShow] = useState(false);
  const pos =
    side === 'right' ? 'left-full ml-2 top-1/2 -translate-y-1/2' :
    side === 'top'   ? 'bottom-full mb-2 left-1/2 -translate-x-1/2' :
                       'top-full mt-2 left-1/2 -translate-x-1/2';
  return (
    <div className="relative inline-block" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className={`absolute ${pos} z-50 px-2 py-1 rounded bg-bg-sunken border border-border text-xs text-fg whitespace-nowrap shadow-lg pointer-events-none`}>
          {label}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add -A
git commit -m "feat(ui): tooltip primitive"
```

---

## Task 10: ServerRail

**Files:**
- Create: `src/renderer/components/ServerRail.tsx`
- Delete: `src/renderer/components/GuildList.tsx`

- [ ] **Step 1: Implement `src/renderer/components/ServerRail.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { GuildSummary } from '../../shared/domain';
import { Tooltip } from './Tooltip';

export function ServerRail({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await api.guilds.list();
      if (!active) return;
      if (res.ok) { setGuilds(res.data); setError(null); }
      else setError(res.error.message);
    };
    load();
    const unsub = api.events.onGuildUpdate(() => load());
    const unsubGw = api.events.onGatewayState((s) => { if (s.status === 'ready') load(); });
    return () => { active = false; unsub(); unsubGw(); };
  }, []);

  return (
    <div className="h-full overflow-y-auto py-3 flex flex-col items-center gap-2 bg-bg-sunken">
      {error && <div className="text-danger text-xs px-2 text-center">{error}</div>}
      {guilds.map(g => (
        <Tooltip key={g.id} label={g.name} side="right">
          <button
            onClick={() => onSelect(g.id)}
            className="relative group"
          >
            {selected === g.id && (
              <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-10 bg-fg rounded-r" />
            )}
            <div className={`w-12 h-12 overflow-hidden bg-border flex items-center justify-center text-sm font-semibold transition-all duration-150
              ${selected === g.id ? 'rounded-2xl' : 'rounded-3xl group-hover:rounded-2xl'}`}>
              {g.iconUrl
                ? <img src={g.iconUrl} alt="" className="w-full h-full object-cover" />
                : g.name.slice(0, 2).toUpperCase()}
            </div>
          </button>
        </Tooltip>
      ))}
      {guilds.length === 0 && !error && (
        <div className="text-fg-muted text-xs px-2 text-center">No guilds</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Delete `src/renderer/components/GuildList.tsx`**

```bash
rm src/renderer/components/GuildList.tsx
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: FAIL — `ShellRoute.tsx` still imports `GuildList`. Will be fixed in Task 16.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(rail): icon-only server rail with hover-to-circle and tooltips"
```

---

## Task 11: ChannelList rewrite with collapsible categories

**Files:**
- Create: `src/renderer/components/CategoryGroup.tsx`
- Modify: `src/renderer/components/ChannelList.tsx`

- [ ] **Step 1: Create `CategoryGroup.tsx`**

```tsx
import type { ReactNode } from 'react';

export function CategoryGroup({
  name, collapsed, onToggle, children,
}: { name: string; collapsed: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="mt-3">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted hover:text-fg"
      >
        <span className={`inline-block transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
        <span className="truncate">{name}</span>
      </button>
      {!collapsed && <div className="mt-1 space-y-0.5">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Replace `src/renderer/components/ChannelList.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { ChannelSummary } from '../../shared/domain';
import { CategoryGroup } from './CategoryGroup';

export function ChannelList({ guildId, selected, onSelect }: { guildId: string | null; selected: string | null; onSelect: (id: string) => void }) {
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Load persisted collapsed state once
  useEffect(() => {
    api.prefs.get('collapsedCategoryIds').then(res => {
      if (res.ok && Array.isArray(res.data)) setCollapsed(new Set(res.data));
    });
  }, []);

  // Persist on change (debounced via timeout)
  useEffect(() => {
    const handle = setTimeout(() => {
      api.prefs.set('collapsedCategoryIds', Array.from(collapsed));
    }, 300);
    return () => clearTimeout(handle);
  }, [collapsed]);

  useEffect(() => {
    if (!guildId) { setChannels([]); return; }
    let active = true;
    const load = async () => {
      const res = await api.guilds.listChannels(guildId);
      if (!active) return;
      if (res.ok) setChannels(res.data);
    };
    load();
    const unsub = api.events.onChannelUpdate((c) => { if (c.guildId === guildId) load(); });
    return () => { active = false; unsub(); };
  }, [guildId]);

  const grouped = useMemo(() => {
    const categories = channels.filter(c => c.type === 'category').sort((a, b) => a.position - b.position);
    const byParent = new Map<string | null, ChannelSummary[]>();
    for (const c of channels) {
      if (c.type === 'category') continue;
      const key = c.parentId;
      const list = byParent.get(key) ?? [];
      list.push(c);
      byParent.set(key, list);
    }
    for (const [k, list] of byParent) {
      list.sort((a, b) => a.position - b.position);
      byParent.set(k, list);
    }
    return { categories, byParent };
  }, [channels]);

  if (!guildId) return <div className="p-3 text-fg-muted text-sm">Select a server.</div>;

  const toggle = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const renderChannel = (c: ChannelSummary, indent = false) => (
    <button
      key={c.id}
      onClick={() => onSelect(c.id)}
      className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left text-sm
        ${indent ? 'pl-6' : ''}
        ${selected === c.id ? 'bg-bg-subtle text-fg' : 'text-fg-muted hover:bg-bg-subtle/50 hover:text-fg'}`}
    >
      <span className="text-xs w-4 inline-block">{kindGlyph(c.type)}</span>
      <span className="truncate">{c.name}</span>
    </button>
  );

  const uncategorized = grouped.byParent.get(null) ?? [];
  const childrenOfTextChannel = (parentTextChannelId: string) => grouped.byParent.get(parentTextChannelId) ?? [];

  const renderChannelWithThreads = (c: ChannelSummary) => (
    <div key={c.id}>
      {renderChannel(c)}
      {childrenOfTextChannel(c.id)
        .filter(t => t.type === 'thread')
        .map(t => renderChannel(t, true))}
    </div>
  );

  return (
    <div className="h-full overflow-y-auto p-2">
      {uncategorized
        .filter(c => c.type !== 'thread')
        .map(renderChannelWithThreads)}
      {grouped.categories.map(cat => {
        const items = (grouped.byParent.get(cat.id) ?? []).filter(c => c.type !== 'thread');
        return (
          <CategoryGroup
            key={cat.id}
            name={cat.name}
            collapsed={collapsed.has(cat.id)}
            onToggle={() => toggle(cat.id)}
          >
            {items.map(renderChannelWithThreads)}
          </CategoryGroup>
        );
      })}
    </div>
  );
}

function kindGlyph(t: ChannelSummary['type']): string {
  switch (t) {
    case 'text': return '#';
    case 'announcement': return '📢';
    case 'voice': return '🔊';
    case 'thread': return '↳';
    case 'category': return '▾';
    case 'forum': return '☰';
    default: return '·';
  }
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
Expected: still failing for ShellRoute (Task 16). That's fine.

```bash
git add -A
git commit -m "feat(channels): collapsible categories, thread nesting, persisted collapsed state"
```

---

## Task 12: Live message hook (TDD)

**Files:**
- Create: `src/renderer/lib/use-channel-messages.ts`
- Create: `src/renderer/lib/__tests__/use-channel-messages.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/renderer/lib/__tests__/use-channel-messages.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { MessageSummary, GatewayState } from '../../../shared/domain';

const mkMsg = (id: string, channelId: string, createdAt = id.length): MessageSummary => ({
  id, channelId, authorId: 'u1', authorTag: 'u1', authorAvatarUrl: null,
  content: id, createdAt, editedAt: null, hasEmbeds: false, hasAttachments: false,
  attachments: [], embeds: [], mentions: [], replyTo: null,
});

let messageCreateCb: ((p: { channelId: string; message: MessageSummary }) => void) | null = null;
let messageUpdateCb: ((p: { channelId: string; message: MessageSummary }) => void) | null = null;
let messageDeleteCb: ((p: { channelId: string; messageId: string }) => void) | null = null;
let gatewayCb: ((s: GatewayState) => void) | null = null;
const historyMock = vi.fn();

vi.stubGlobal('window', Object.assign(globalThis.window ?? {}, {
  botcord: {
    messages: { history: historyMock },
    events: {
      onMessageCreate: (cb: typeof messageCreateCb) => { messageCreateCb = cb; return () => { messageCreateCb = null; }; },
      onMessageUpdate: (cb: typeof messageUpdateCb) => { messageUpdateCb = cb; return () => { messageUpdateCb = null; }; },
      onMessageDelete: (cb: typeof messageDeleteCb) => { messageDeleteCb = cb; return () => { messageDeleteCb = null; }; },
      onGatewayState: (cb: typeof gatewayCb) => { gatewayCb = cb; return () => { gatewayCb = null; }; },
    },
  },
}));

import { useChannelMessages } from '../use-channel-messages';

beforeEach(() => {
  historyMock.mockReset();
  messageCreateCb = null;
  messageUpdateCb = null;
  messageDeleteCb = null;
});

describe('useChannelMessages', () => {
  it('fetches initial history sorted oldest-first', async () => {
    historyMock.mockResolvedValue({ ok: true, data: [mkMsg('c'), mkMsg('a'), mkMsg('b')] });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => expect(result.current.messages.length).toBe(3));
    expect(result.current.messages.map(m => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('appends on messageCreate for matching channel', async () => {
    historyMock.mockResolvedValue({ ok: true, data: [mkMsg('a')] });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    act(() => { messageCreateCb?.({ channelId: 'chan-1', message: mkMsg('b') }); });
    expect(result.current.messages.map(m => m.id)).toEqual(['a', 'b']);
  });

  it('ignores messageCreate for other channels', async () => {
    historyMock.mockResolvedValue({ ok: true, data: [mkMsg('a')] });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    act(() => { messageCreateCb?.({ channelId: 'chan-other', message: mkMsg('b') }); });
    expect(result.current.messages.map(m => m.id)).toEqual(['a']);
  });

  it('dedupes when messageCreate arrives for an id we already have', async () => {
    historyMock.mockResolvedValue({ ok: true, data: [mkMsg('a')] });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    act(() => { messageCreateCb?.({ channelId: 'chan-1', message: mkMsg('a') }); });
    expect(result.current.messages.length).toBe(1);
  });

  it('patches in place on messageUpdate', async () => {
    historyMock.mockResolvedValue({ ok: true, data: [mkMsg('a')] });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    act(() => { messageUpdateCb?.({ channelId: 'chan-1', message: { ...mkMsg('a'), content: 'edited' } }); });
    expect(result.current.messages[0]!.content).toBe('edited');
  });

  it('removes on messageDelete', async () => {
    historyMock.mockResolvedValue({ ok: true, data: [mkMsg('a'), mkMsg('b')] });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => expect(result.current.messages.length).toBe(2));
    act(() => { messageDeleteCb?.({ channelId: 'chan-1', messageId: 'a' }); });
    expect(result.current.messages.map(m => m.id)).toEqual(['b']);
  });

  it('loadOlder prepends and stops paginating when fewer than limit returned', async () => {
    historyMock.mockResolvedValueOnce({ ok: true, data: [mkMsg('b'), mkMsg('a')] });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => expect(result.current.messages.length).toBe(2));

    historyMock.mockResolvedValueOnce({ ok: true, data: [mkMsg('z'), mkMsg('y')] });
    await act(async () => { await result.current.loadOlder(); });
    expect(result.current.messages.map(m => m.id)).toEqual(['y', 'z', 'a', 'b']);
    expect(result.current.hasMore).toBe(true);

    historyMock.mockResolvedValueOnce({ ok: true, data: [mkMsg('x')] });
    await act(async () => { await result.current.loadOlder(); });
    expect(result.current.hasMore).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `npx vitest run src/renderer/lib/__tests__/use-channel-messages.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/renderer/lib/use-channel-messages.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageSummary } from '../../shared/domain';

const PAGE = 50;

export type UseChannelMessages = {
  messages: MessageSummary[];
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  loadOlder: () => Promise<void>;
};

export function useChannelMessages(channelId: string | null): UseChannelMessages {
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelIdRef = useRef(channelId);
  channelIdRef.current = channelId;

  // Initial load + reset on channel change.
  useEffect(() => {
    if (!channelId) { setMessages([]); setHasMore(false); return; }
    let active = true;
    setLoading(true);
    setError(null);
    setHasMore(true);
    window.botcord.messages.history(channelId, { limit: PAGE }).then(res => {
      if (!active || channelIdRef.current !== channelId) return;
      if (res.ok) {
        const sorted = [...res.data].sort((a, b) => a.createdAt - b.createdAt);
        setMessages(sorted);
        setHasMore(res.data.length >= PAGE);
      } else {
        setError(res.error.message);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [channelId]);

  // Live event subscriptions.
  useEffect(() => {
    if (!channelId) return;
    const unsubC = window.botcord.events.onMessageCreate(({ channelId: cid, message }) => {
      if (cid !== channelIdRef.current) return;
      setMessages(prev => prev.some(m => m.id === message.id) ? prev : [...prev, message]);
    });
    const unsubU = window.botcord.events.onMessageUpdate(({ channelId: cid, message }) => {
      if (cid !== channelIdRef.current) return;
      setMessages(prev => prev.map(m => m.id === message.id ? message : m));
    });
    const unsubD = window.botcord.events.onMessageDelete(({ channelId: cid, messageId }) => {
      if (cid !== channelIdRef.current) return;
      setMessages(prev => prev.filter(m => m.id !== messageId));
    });
    return () => { unsubC(); unsubU(); unsubD(); };
  }, [channelId]);

  const loadOlder = useCallback(async () => {
    const cid = channelIdRef.current;
    if (!cid || !hasMore || loading) return;
    const oldest = messages[0];
    if (!oldest) return;
    setLoading(true);
    const res = await window.botcord.messages.history(cid, { limit: PAGE, before: oldest.id });
    if (cid !== channelIdRef.current) { setLoading(false); return; }
    if (res.ok) {
      const sorted = [...res.data].sort((a, b) => a.createdAt - b.createdAt);
      setMessages(prev => [...sorted, ...prev]);
      setHasMore(res.data.length >= PAGE);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
  }, [messages, hasMore, loading]);

  return { messages, loading, hasMore, error, loadOlder };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/renderer/lib/__tests__/use-channel-messages.test.ts`
Expected: PASS, all 7 cases.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(messages): useChannelMessages hook with live updates and pagination"
```

---

## Task 13: Guild emoji hook

**Files:**
- Create: `src/renderer/lib/use-guild-emojis.ts`

- [ ] **Step 1: Implement**

```ts
import { useEffect, useState } from 'react';
import type { GuildEmoji } from '../../shared/domain';
import { api } from './api';

export function useGuildEmojis(guildId: string | null): GuildEmoji[] {
  const [emojis, setEmojis] = useState<GuildEmoji[]>([]);

  useEffect(() => {
    if (!guildId) { setEmojis([]); return; }
    let active = true;
    api.guilds.listEmojis(guildId).then(res => {
      if (!active) return;
      if (res.ok) setEmojis(res.data);
    });
    const unsub = api.events.onGuildEmojisUpdate(({ guildId: gid, emojis: list }) => {
      if (gid === guildId) setEmojis(list);
    });
    return () => { active = false; unsub(); };
  }, [guildId]);

  return emojis;
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`

```bash
git add -A
git commit -m "feat(emojis): useGuildEmojis hook"
```

---

## Task 14: Message rendering — MessageList, MessageGroup, MessageContent, EmbedCard, AttachmentInline

**Files:**
- Create: `src/renderer/components/MessageGroup.tsx`
- Create: `src/renderer/components/MessageContent.tsx`
- Create: `src/renderer/components/EmbedCard.tsx`
- Create: `src/renderer/components/AttachmentInline.tsx`
- Create: `src/renderer/components/MessageList.tsx`

- [ ] **Step 1: Create `MessageContent.tsx`**

```tsx
import type { MessageSummary } from '../../shared/domain';
import { Markdown } from './Markdown';
import { EmbedCard } from './EmbedCard';
import { AttachmentInline } from './AttachmentInline';

export function MessageContent({ message }: { message: MessageSummary }) {
  return (
    <div className="space-y-1">
      {message.content && (
        <div className="text-sm text-fg whitespace-pre-wrap break-words">
          <Markdown source={message.content} mentions={message.mentions} />
          {message.editedAt && <span className="text-fg-muted text-[10px] ml-1">(edited)</span>}
        </div>
      )}
      {message.attachments.map(a => <AttachmentInline key={a.id} attachment={a} />)}
      {message.embeds.map((e, i) => <EmbedCard key={i} embed={e} />)}
    </div>
  );
}
```

- [ ] **Step 2: Create `EmbedCard.tsx`**

```tsx
import type { MessageEmbedSummary } from '../../shared/domain';
import { Markdown } from './Markdown';

export function EmbedCard({ embed }: { embed: MessageEmbedSummary }) {
  const accent = embed.color != null
    ? `#${embed.color.toString(16).padStart(6, '0')}`
    : 'var(--tw-color-border, #2c2e36)';
  return (
    <div className="border-l-4 bg-bg-subtle/40 rounded p-3 max-w-2xl text-sm" style={{ borderLeftColor: accent }}>
      {embed.authorName && <div className="font-medium text-fg-muted mb-1">{embed.authorName}</div>}
      {embed.title && (
        embed.url
          ? <a href={embed.url} className="block font-semibold text-accent hover:underline" onClick={(e) => { e.preventDefault(); window.botcord.system.openExternal(embed.url!); }}>{embed.title}</a>
          : <div className="font-semibold">{embed.title}</div>
      )}
      {embed.description && (
        <div className="mt-1 text-fg whitespace-pre-wrap"><Markdown source={embed.description} /></div>
      )}
      {embed.fields.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mt-2">
          {embed.fields.map((f, i) => (
            <div key={i} className={f.inline ? '' : 'col-span-2'}>
              <div className="font-semibold text-xs">{f.name}</div>
              <div className="text-xs text-fg-muted whitespace-pre-wrap"><Markdown source={f.value} /></div>
            </div>
          ))}
        </div>
      )}
      {embed.image && <img src={embed.image} alt="" className="mt-2 rounded max-h-64" />}
      {embed.footerText && <div className="mt-2 text-[10px] text-fg-muted">{embed.footerText}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Create `AttachmentInline.tsx`**

```tsx
import type { MessageAttachment } from '../../shared/domain';

export function AttachmentInline({ attachment }: { attachment: MessageAttachment }) {
  const isImage = attachment.contentType?.startsWith('image/');
  if (isImage) {
    return (
      <a href={attachment.url} onClick={(e) => { e.preventDefault(); window.botcord.system.openExternal(attachment.url); }}>
        <img
          src={attachment.url}
          alt={attachment.name}
          className="rounded border border-border max-w-md max-h-96"
        />
      </a>
    );
  }
  return (
    <a
      href={attachment.url}
      onClick={(e) => { e.preventDefault(); window.botcord.system.openExternal(attachment.url); }}
      className="inline-flex items-center gap-2 px-3 py-2 bg-bg-subtle border border-border rounded text-sm hover:bg-bg-sunken"
    >
      <span>📎</span>
      <span className="font-medium">{attachment.name}</span>
      <span className="text-fg-muted text-xs">{formatBytes(attachment.size)}</span>
    </a>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
```

- [ ] **Step 4: Create `MessageGroup.tsx`**

```tsx
import type { MessageSummary } from '../../shared/domain';
import { MessageContent } from './MessageContent';

export function MessageGroup({ messages }: { messages: MessageSummary[] }) {
  if (messages.length === 0) return null;
  const head = messages[0]!;
  const ts = new Date(head.createdAt).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
  return (
    <div className="px-4 py-1 hover:bg-bg-subtle/30 group flex gap-3">
      <div className="w-10 shrink-0">
        {head.authorAvatarUrl
          ? <img src={head.authorAvatarUrl} alt="" className="w-10 h-10 rounded-full" />
          : <div className="w-10 h-10 rounded-full bg-border flex items-center justify-center text-xs">{head.authorTag.slice(0, 2).toUpperCase()}</div>}
      </div>
      <div className="flex-1 min-w-0">
        <div data-message-id={head.id}>
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-fg">{head.authorTag}</span>
            <span className="text-[10px] text-fg-muted">{ts}</span>
          </div>
          <MessageContent message={head} />
        </div>
        {messages.slice(1).map(m => (
          <div key={m.id} data-message-id={m.id} className="mt-1">
            <MessageContent message={m} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `MessageList.tsx`**

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MessageSummary } from '../../shared/domain';
import { useChannelMessages } from '../lib/use-channel-messages';
import { MessageGroup } from './MessageGroup';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function groupMessages(messages: MessageSummary[]): MessageSummary[][] {
  const groups: MessageSummary[][] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && prev.authorId === m.authorId && (m.createdAt - prev.createdAt) < GROUP_WINDOW_MS) {
      last!.push(m);
    } else {
      groups.push([m]);
    }
  }
  return groups;
}

export function MessageList({ channelId }: { channelId: string | null }) {
  const { messages, loading, hasMore, loadOlder, error } = useChannelMessages(channelId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pendingNew, setPendingNew] = useState(0);
  const previousLength = useRef(0);
  const previousChannelId = useRef<string | null>(null);
  const anchorRef = useRef<{ id: string; top: number } | null>(null);

  // Auto-scroll to bottom on initial load and when user is near bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (previousChannelId.current !== channelId) {
      // Channel changed: jump to bottom on first paint.
      previousChannelId.current = channelId;
      setPendingNew(0);
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
      previousLength.current = messages.length;
      return;
    }

    if (messages.length > previousLength.current) {
      const newCount = messages.length - previousLength.current;
      const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 100;
      if (nearBottom) {
        requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
      } else if (anchorRef.current === null) {
        // Only count new messages as "pending" when the prepend wasn't from loadOlder.
        setPendingNew(p => p + newCount);
      }
    }
    previousLength.current = messages.length;
  }, [messages, channelId]);

  // Anchor preservation for loadOlder prepends.
  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const target = el.querySelector(`[data-message-id="${anchorRef.current.id}"]`) as HTMLElement | null;
    if (target) {
      const newTop = target.getBoundingClientRect().top;
      el.scrollTop += (newTop - anchorRef.current.top);
    }
    anchorRef.current = null;
  }, [messages]);

  const onScroll = async () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 200 && hasMore && !loading && messages.length > 0) {
      const oldest = messages[0]!;
      const target = el.querySelector(`[data-message-id="${oldest.id}"]`) as HTMLElement | null;
      if (target) anchorRef.current = { id: oldest.id, top: target.getBoundingClientRect().top };
      await loadOlder();
    }
    if (el.scrollHeight - (el.scrollTop + el.clientHeight) < 100) {
      setPendingNew(0);
    }
  };

  if (!channelId) return <div className="flex-1 flex items-center justify-center text-fg-muted">Select a channel</div>;

  const groups = groupMessages(messages);
  const flat: MessageSummary[] = messages;

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        {error && <div className="p-3 text-danger text-sm">{error}</div>}
        {loading && messages.length === 0 && <div className="p-3 text-fg-muted text-sm">Loading…</div>}
        {!hasMore && messages.length > 0 && (
          <div className="text-center text-[10px] text-fg-muted py-2">— Beginning of channel history —</div>
        )}
        {groups.map((g, gi) => (
          <MessageGroup key={`g-${gi}-${g[0]!.id}`} messages={g} />
        ))}
      </div>
      {pendingNew > 0 && (
        <button
          className="absolute bottom-3 right-4 px-3 py-1 bg-accent text-white rounded-full text-xs shadow-lg hover:bg-accent-hover"
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
            setPendingNew(0);
          }}
        >
          ↓ Jump to present ({pendingNew} new)
        </button>
      )}
      {/* Reference flat to satisfy unused-var linting if it ever appears */}
      {flat.length === 0 && null}
    </div>
  );
}
```

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add -A
git commit -m "feat(messages): MessageList with grouping, infinite scroll, jump-to-present"
```

---

## Task 15: Composer + AttachmentTray + EmojiPicker + emoji data

**Files:**
- Create: `src/renderer/lib/emoji-data.ts`
- Create: `src/renderer/components/AttachmentTray.tsx`
- Create: `src/renderer/components/EmojiPicker.tsx`
- Create: `src/renderer/components/Composer.tsx`

- [ ] **Step 1: Create `src/renderer/lib/emoji-data.ts`**

A small curated dataset is enough for v1. Use this list — it covers the common categories without ballooning the bundle:

```ts
export type StandardEmoji = { char: string; name: string; category: string; keywords: string };

export const STANDARD_EMOJI: StandardEmoji[] = [
  { char: '😀', name: 'grinning', category: 'Smileys', keywords: 'smile happy' },
  { char: '😃', name: 'smiley', category: 'Smileys', keywords: 'smile happy joy' },
  { char: '😄', name: 'smile', category: 'Smileys', keywords: 'smile happy laugh' },
  { char: '😁', name: 'grin', category: 'Smileys', keywords: 'grin happy' },
  { char: '😆', name: 'laughing', category: 'Smileys', keywords: 'laugh haha' },
  { char: '😅', name: 'sweat_smile', category: 'Smileys', keywords: 'sweat smile' },
  { char: '🤣', name: 'rofl', category: 'Smileys', keywords: 'rofl laugh hard' },
  { char: '😂', name: 'joy', category: 'Smileys', keywords: 'tears laugh cry' },
  { char: '🙂', name: 'slight_smile', category: 'Smileys', keywords: 'slight smile' },
  { char: '🙃', name: 'upside_down', category: 'Smileys', keywords: 'upside down' },
  { char: '😉', name: 'wink', category: 'Smileys', keywords: 'wink' },
  { char: '😊', name: 'blush', category: 'Smileys', keywords: 'blush smile' },
  { char: '😇', name: 'innocent', category: 'Smileys', keywords: 'innocent halo' },
  { char: '😍', name: 'heart_eyes', category: 'Smileys', keywords: 'love heart eyes' },
  { char: '🤩', name: 'star_struck', category: 'Smileys', keywords: 'stars eyes amazed' },
  { char: '😘', name: 'kiss', category: 'Smileys', keywords: 'kiss heart' },
  { char: '😗', name: 'kissing', category: 'Smileys', keywords: 'kiss' },
  { char: '🤔', name: 'thinking', category: 'Smileys', keywords: 'think hmm' },
  { char: '🤨', name: 'raised_brow', category: 'Smileys', keywords: 'eyebrow' },
  { char: '😐', name: 'neutral', category: 'Smileys', keywords: 'meh' },
  { char: '😑', name: 'expressionless', category: 'Smileys', keywords: 'flat' },
  { char: '😶', name: 'no_mouth', category: 'Smileys', keywords: 'silent' },
  { char: '🙄', name: 'eyeroll', category: 'Smileys', keywords: 'roll eyes' },
  { char: '😏', name: 'smirk', category: 'Smileys', keywords: 'smirk' },
  { char: '😒', name: 'unamused', category: 'Smileys', keywords: 'meh annoyed' },
  { char: '😞', name: 'disappointed', category: 'Smileys', keywords: 'sad' },
  { char: '😔', name: 'pensive', category: 'Smileys', keywords: 'sad' },
  { char: '😟', name: 'worried', category: 'Smileys', keywords: 'worry sad' },
  { char: '😕', name: 'confused', category: 'Smileys', keywords: 'confused' },
  { char: '🙁', name: 'slight_frown', category: 'Smileys', keywords: 'sad frown' },
  { char: '☹️', name: 'frown', category: 'Smileys', keywords: 'sad frown' },
  { char: '😣', name: 'persevere', category: 'Smileys', keywords: 'try' },
  { char: '😖', name: 'confounded', category: 'Smileys', keywords: 'confounded' },
  { char: '😫', name: 'tired', category: 'Smileys', keywords: 'tired' },
  { char: '😩', name: 'weary', category: 'Smileys', keywords: 'weary' },
  { char: '🥺', name: 'pleading', category: 'Smileys', keywords: 'plead beg' },
  { char: '😢', name: 'cry', category: 'Smileys', keywords: 'tear sad' },
  { char: '😭', name: 'sob', category: 'Smileys', keywords: 'sob cry' },
  { char: '😡', name: 'angry', category: 'Smileys', keywords: 'angry mad' },
  { char: '🤬', name: 'cursing', category: 'Smileys', keywords: 'curse mad' },
  { char: '🥳', name: 'party', category: 'Smileys', keywords: 'party celebrate' },
  { char: '😎', name: 'cool', category: 'Smileys', keywords: 'sunglasses cool' },
  { char: '🤓', name: 'nerd', category: 'Smileys', keywords: 'nerd glasses' },
  { char: '🥶', name: 'cold', category: 'Smileys', keywords: 'cold freeze' },
  { char: '🥵', name: 'hot', category: 'Smileys', keywords: 'hot heat' },
  { char: '😱', name: 'scream', category: 'Smileys', keywords: 'scream shock' },
  { char: '🤯', name: 'mind_blown', category: 'Smileys', keywords: 'mind blown' },
  { char: '👍', name: 'thumbsup', category: 'People', keywords: 'thumbs up like' },
  { char: '👎', name: 'thumbsdown', category: 'People', keywords: 'thumbs down dislike' },
  { char: '👏', name: 'clap', category: 'People', keywords: 'clap applause' },
  { char: '🙌', name: 'raised_hands', category: 'People', keywords: 'praise hooray' },
  { char: '👌', name: 'ok_hand', category: 'People', keywords: 'ok hand' },
  { char: '✌️', name: 'peace', category: 'People', keywords: 'peace' },
  { char: '🤞', name: 'crossed_fingers', category: 'People', keywords: 'crossed fingers luck' },
  { char: '🤟', name: 'love_you', category: 'People', keywords: 'love you' },
  { char: '🤘', name: 'rock_on', category: 'People', keywords: 'rock metal' },
  { char: '👋', name: 'wave', category: 'People', keywords: 'wave hi bye' },
  { char: '🤚', name: 'raised_back_hand', category: 'People', keywords: 'high five' },
  { char: '✋', name: 'raised_hand', category: 'People', keywords: 'high five stop' },
  { char: '👀', name: 'eyes', category: 'People', keywords: 'eyes look' },
  { char: '🫡', name: 'salute', category: 'People', keywords: 'salute' },
  { char: '🙏', name: 'pray', category: 'People', keywords: 'pray thanks' },
  { char: '💪', name: 'muscle', category: 'People', keywords: 'flex strong' },
  { char: '❤️', name: 'heart', category: 'Symbols', keywords: 'love heart red' },
  { char: '🧡', name: 'orange_heart', category: 'Symbols', keywords: 'orange heart' },
  { char: '💛', name: 'yellow_heart', category: 'Symbols', keywords: 'yellow heart' },
  { char: '💚', name: 'green_heart', category: 'Symbols', keywords: 'green heart' },
  { char: '💙', name: 'blue_heart', category: 'Symbols', keywords: 'blue heart' },
  { char: '💜', name: 'purple_heart', category: 'Symbols', keywords: 'purple heart' },
  { char: '🖤', name: 'black_heart', category: 'Symbols', keywords: 'black heart' },
  { char: '🤍', name: 'white_heart', category: 'Symbols', keywords: 'white heart' },
  { char: '💔', name: 'broken_heart', category: 'Symbols', keywords: 'broken heart' },
  { char: '💯', name: 'hundred', category: 'Symbols', keywords: '100 perfect' },
  { char: '🔥', name: 'fire', category: 'Symbols', keywords: 'fire lit' },
  { char: '⭐', name: 'star', category: 'Symbols', keywords: 'star' },
  { char: '✨', name: 'sparkles', category: 'Symbols', keywords: 'sparkles shine' },
  { char: '⚡', name: 'lightning', category: 'Symbols', keywords: 'zap lightning' },
  { char: '☀️', name: 'sun', category: 'Symbols', keywords: 'sun' },
  { char: '🌙', name: 'moon', category: 'Symbols', keywords: 'moon night' },
  { char: '⚠️', name: 'warning', category: 'Symbols', keywords: 'warning' },
  { char: '✅', name: 'check', category: 'Symbols', keywords: 'check ok done' },
  { char: '❌', name: 'cross', category: 'Symbols', keywords: 'no cross x' },
  { char: '❓', name: 'question', category: 'Symbols', keywords: 'question' },
  { char: '❗', name: 'exclamation', category: 'Symbols', keywords: 'exclaim' },
  { char: '🎉', name: 'party_popper', category: 'Symbols', keywords: 'celebrate party' },
  { char: '🎊', name: 'confetti', category: 'Symbols', keywords: 'confetti party' },
  { char: '🚀', name: 'rocket', category: 'Travel', keywords: 'rocket launch' },
  { char: '🐱', name: 'cat', category: 'Animals', keywords: 'cat kitten' },
  { char: '🐶', name: 'dog', category: 'Animals', keywords: 'dog puppy' },
  { char: '🦊', name: 'fox', category: 'Animals', keywords: 'fox' },
  { char: '🐼', name: 'panda', category: 'Animals', keywords: 'panda' },
  { char: '🐸', name: 'frog', category: 'Animals', keywords: 'frog' },
  { char: '🦀', name: 'crab', category: 'Animals', keywords: 'crab' },
  { char: '🍕', name: 'pizza', category: 'Food', keywords: 'pizza food' },
  { char: '🍔', name: 'burger', category: 'Food', keywords: 'burger food' },
  { char: '🍣', name: 'sushi', category: 'Food', keywords: 'sushi food' },
  { char: '🍺', name: 'beer', category: 'Food', keywords: 'beer drink' },
  { char: '🍷', name: 'wine', category: 'Food', keywords: 'wine drink' },
  { char: '☕', name: 'coffee', category: 'Food', keywords: 'coffee drink' },
];

export const EMOJI_CATEGORIES = ['Smileys', 'People', 'Animals', 'Food', 'Travel', 'Symbols'] as const;
```

- [ ] **Step 2: Create `EmojiPicker.tsx`**

```tsx
import { useState, useMemo } from 'react';
import { STANDARD_EMOJI, EMOJI_CATEGORIES } from '../lib/emoji-data';
import type { GuildEmoji } from '../../shared/domain';

type Tab = 'standard' | 'server';

export function EmojiPicker({
  guildEmojis,
  onSelect,
  onClose,
}: {
  guildEmojis: GuildEmoji[];
  onSelect: (token: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(guildEmojis.length > 0 ? 'server' : 'standard');
  const [query, setQuery] = useState('');

  const filteredStd = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return STANDARD_EMOJI;
    return STANDARD_EMOJI.filter(e => e.name.includes(q) || e.keywords.includes(q));
  }, [query]);

  const filteredServer = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return guildEmojis;
    return guildEmojis.filter(e => e.name.toLowerCase().includes(q));
  }, [guildEmojis, query]);

  return (
    <div className="absolute bottom-full right-0 mb-2 w-80 max-h-96 bg-bg-subtle border border-border rounded-lg shadow-2xl flex flex-col z-50">
      <div className="flex border-b border-border">
        <button
          className={`flex-1 px-3 py-2 text-xs font-semibold ${tab === 'server' ? 'bg-bg-sunken text-fg' : 'text-fg-muted hover:text-fg'}`}
          onClick={() => setTab('server')}
          disabled={guildEmojis.length === 0}
        >
          Server
        </button>
        <button
          className={`flex-1 px-3 py-2 text-xs font-semibold ${tab === 'standard' ? 'bg-bg-sunken text-fg' : 'text-fg-muted hover:text-fg'}`}
          onClick={() => setTab('standard')}
        >
          Standard
        </button>
        <button className="px-3 py-2 text-xs text-fg-muted hover:text-fg" onClick={onClose}>×</button>
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search…"
        className="m-2 px-2 py-1 bg-bg-sunken border border-border rounded text-xs"
      />
      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'server' ? (
          filteredServer.length === 0
            ? <div className="text-fg-muted text-xs p-3 text-center">No custom emoji</div>
            : (
              <div className="grid grid-cols-8 gap-1">
                {filteredServer.map(e => (
                  <button
                    key={e.id}
                    title={`:${e.name}:`}
                    className="hover:bg-bg-sunken rounded p-1"
                    onClick={() => onSelect(`<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`)}
                  >
                    <img src={e.url} alt={e.name} className="w-7 h-7" />
                  </button>
                ))}
              </div>
            )
        ) : (
          EMOJI_CATEGORIES.map(cat => {
            const items = filteredStd.filter(e => e.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat} className="mb-2">
                <div className="text-[10px] uppercase font-semibold text-fg-muted px-1 mb-1">{cat}</div>
                <div className="grid grid-cols-8 gap-1">
                  {items.map(e => (
                    <button
                      key={e.name}
                      title={`:${e.name}:`}
                      className="hover:bg-bg-sunken rounded p-1 text-xl"
                      onClick={() => onSelect(e.char)}
                    >
                      {e.char}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `AttachmentTray.tsx`**

```tsx
import { useEffect, useMemo } from 'react';

export function AttachmentTray({
  files, onRemove,
}: { files: File[]; onRemove: (idx: number) => void }) {
  const previews = useMemo(() => files.map(f => f.type.startsWith('image/') ? URL.createObjectURL(f) : null), [files]);
  useEffect(() => () => { previews.forEach(u => { if (u) URL.revokeObjectURL(u); }); }, [previews]);

  if (files.length === 0) return null;

  return (
    <div className="flex gap-2 px-3 py-2 border-b border-border bg-bg-sunken overflow-x-auto">
      {files.map((f, i) => (
        <div key={i} className="relative shrink-0 w-20 h-20 rounded bg-bg-subtle border border-border flex items-center justify-center text-[10px] text-fg-muted overflow-hidden">
          {previews[i]
            ? <img src={previews[i]!} alt={f.name} className="w-full h-full object-cover" />
            : <span className="px-1 text-center break-all">📄 {f.name.slice(0, 16)}</span>}
          <button
            onClick={() => onRemove(i)}
            className="absolute top-0 right-0 w-5 h-5 bg-danger text-white rounded-bl text-xs leading-none"
          >×</button>
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 truncate">
            {formatSize(f.size)}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
```

- [ ] **Step 4: Create `Composer.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useGuildEmojis } from '../lib/use-guild-emojis';
import { EmojiPicker } from './EmojiPicker';
import { AttachmentTray } from './AttachmentTray';
import { pushToast } from './Toaster';
import type { GatewayState } from '../../shared/domain';

const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;

export function Composer({ channelId, guildId }: { channelId: string | null; guildId: string | null }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gateway, setGateway] = useState<GatewayState>({ status: 'connecting' });
  const [dragOver, setDragOver] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const guildEmojis = useGuildEmojis(emojiOpen ? guildId : null);

  useEffect(() => {
    api.bot.getStatus().then(s => { if (s.kind === 'configured') setGateway(s.gateway); });
    return api.events.onGatewayState(setGateway);
  }, []);

  // Auto-resize textarea.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 240) + 'px';
  }, [text]);

  const addFiles = (incoming: File[]) => {
    const allowed: File[] = [];
    for (const f of incoming) {
      if (f.size > MAX_BYTES) { pushToast('warn', `${f.name} is over 25MB`); continue; }
      allowed.push(f);
    }
    setFiles(prev => {
      const merged = [...prev, ...allowed];
      if (merged.length > MAX_FILES) {
        pushToast('warn', `Max ${MAX_FILES} attachments`);
        return merged.slice(0, MAX_FILES);
      }
      return merged;
    });
  };

  const onPick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = () => {
      if (input.files) addFiles(Array.from(input.files));
    };
    input.click();
  };

  const insertAtCursor = (token: string) => {
    const ta = taRef.current;
    if (!ta) { setText(t => t + token); return; }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setText(t => t.slice(0, start) + token + t.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + token.length;
    });
  };

  const send = async () => {
    if (!channelId) return;
    const content = text.trim();
    if (content.length === 0 && files.length === 0) return;
    setBusy(true);
    let res;
    if (files.length > 0) {
      const attachments = await Promise.all(files.map(async f => ({
        name: f.name,
        mimeType: f.type || 'application/octet-stream',
        bytes: new Uint8Array(await f.arrayBuffer()),
      })));
      res = await api.messages.sendWithAttachments(channelId, content, attachments);
    } else {
      res = await api.messages.send(channelId, content);
    }
    setBusy(false);
    if (!res.ok) {
      pushToast('danger', `Send failed: ${res.error.message}`);
      return;
    }
    setText('');
    setFiles([]);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files) addFiles(Array.from(e.dataTransfer.files));
  };

  const offline = gateway.status !== 'ready';

  return (
    <div
      className="border-t border-border bg-bg relative"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 bg-accent/20 border-2 border-dashed border-accent flex items-center justify-center z-40 pointer-events-none">
          <span className="text-fg font-semibold">Drop to attach</span>
        </div>
      )}
      <AttachmentTray files={files} onRemove={(i) => setFiles(prev => prev.filter((_, idx) => idx !== i))} />
      {offline && (
        <div className="px-3 py-1 text-xs text-warn bg-warn/10">Bot is not connected — sending disabled.</div>
      )}
      <div className="flex items-end gap-2 px-3 py-2">
        <button
          onClick={onPick}
          disabled={offline || busy}
          className="text-fg-muted hover:text-fg p-2 disabled:opacity-40"
          title="Attach files"
        >📎</button>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          disabled={offline || busy}
          placeholder={channelId ? 'Message…' : 'Select a channel'}
          rows={1}
          className="flex-1 bg-bg-sunken border border-border rounded px-3 py-2 text-sm resize-none disabled:opacity-50"
        />
        <div className="relative">
          <button
            onClick={() => setEmojiOpen(o => !o)}
            disabled={offline || busy}
            className="text-fg-muted hover:text-fg p-2 disabled:opacity-40"
            title="Emoji"
          >😀</button>
          {emojiOpen && (
            <EmojiPicker
              guildEmojis={guildEmojis}
              onSelect={(token) => { insertAtCursor(token); }}
              onClose={() => setEmojiOpen(false)}
            />
          )}
        </div>
        <button
          onClick={send}
          disabled={offline || busy || (text.trim().length === 0 && files.length === 0) || !channelId}
          className="px-3 py-2 bg-accent text-white rounded text-sm disabled:opacity-40 hover:bg-accent-hover"
        >Send</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add -A
git commit -m "feat(composer): chat input with attachments, drag-drop, and emoji picker"
```

---

## Task 16: ShellRoute and ChannelView wiring

**Files:**
- Create: `src/renderer/routes/shell/ChannelView.tsx`
- Modify: `src/renderer/routes/shell/ShellRoute.tsx`

- [ ] **Step 1: Create `ChannelView.tsx`**

```tsx
import { MessageList } from '../../components/MessageList';
import { Composer } from '../../components/Composer';

export function ChannelView({ channelId, guildId, channelName }: { channelId: string | null; guildId: string | null; channelName: string | null }) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="h-10 border-b border-border flex items-center px-4 bg-bg-subtle shrink-0">
        <span className="text-fg-muted text-sm mr-1">#</span>
        <span className="font-semibold text-sm">{channelName ?? 'Select a channel'}</span>
      </div>
      <MessageList channelId={channelId} />
      <Composer channelId={channelId} guildId={guildId} />
    </div>
  );
}
```

- [ ] **Step 2: Replace `src/renderer/routes/shell/ShellRoute.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { ServerRail } from '../../components/ServerRail';
import { ChannelList } from '../../components/ChannelList';
import { StatusPill } from '../../components/StatusPill';
import { SettingsPanel } from '../../components/SettingsPanel';
import { Toaster } from '../../components/Toaster';
import { ChannelView } from './ChannelView';
import { api } from '../../lib/api';
import type { ChannelSummary } from '../../../shared/domain';

export function ShellRoute() {
  const [guildId, setGuildId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!guildId) { setChannels([]); return; }
    api.guilds.listChannels(guildId).then(res => { if (res.ok) setChannels(res.data); });
  }, [guildId]);

  const channelName = channels.find(c => c.id === channelId)?.name ?? null;

  return (
    <div className="h-full flex flex-col">
      <header className="h-10 border-b border-border flex items-center justify-between px-3 bg-bg-subtle shrink-0">
        <div className="font-semibold tracking-tight">BotCord</div>
        <div className="flex items-center gap-3">
          <StatusPill />
          <button className="text-xs text-fg-muted hover:text-fg" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </header>
      <div className="flex-1 grid grid-cols-[72px_240px_1fr] min-h-0">
        <aside className="border-r border-border min-h-0">
          <ServerRail selected={guildId} onSelect={(id) => { setGuildId(id); setChannelId(null); }} />
        </aside>
        <aside className="border-r border-border min-h-0 bg-bg-subtle/40">
          <ChannelList guildId={guildId} selected={channelId} onSelect={setChannelId} />
        </aside>
        <ChannelView channelId={channelId} guildId={guildId} channelName={channelName} />
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      <Toaster />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + tests + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: all PASS.

- [ ] **Step 4: Smoke test**

Run: `npm run dev`. With a real bot connected, verify:
1. Server rail is icon-only with tooltips on hover and a hover-to-circle animation.
2. Channel list shows categories with collapsible chevrons.
3. Selecting a channel loads recent messages with avatars + author + timestamp.
4. Scrolling to the top loads older messages without losing scroll position.
5. Type a message and press Enter — it appears in the channel both on Discord and in the BotCord history.
6. Drop a file onto the channel — it appears in the tray. Send — it uploads.
7. Click the emoji picker — Server tab shows custom emoji; clicking inserts `<:name:id>`. Standard tab inserts unicode.
8. Have someone else post a message — it appears live.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shell): discord-style three-pane shell wired end-to-end"
```

---

## Task 17: EmojiPicker tests

**Files:**
- Create: `src/renderer/components/__tests__/EmojiPicker.test.tsx`

- [ ] **Step 1: Implement**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmojiPicker } from '../EmojiPicker';

describe('EmojiPicker', () => {
  const guildEmojis = [
    { id: '111', name: 'fire', animated: false, guildId: 'g1', url: 'https://cdn.discordapp.com/emojis/111.png' },
    { id: '222', name: 'dance', animated: true, guildId: 'g1', url: 'https://cdn.discordapp.com/emojis/222.gif' },
  ];

  it('renders Server tab when guild emojis present and emits the discord token format', () => {
    const onSelect = vi.fn();
    render(<EmojiPicker guildEmojis={guildEmojis} onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(screen.getByTitle(':fire:'));
    expect(onSelect).toHaveBeenCalledWith('<:fire:111>');
  });

  it('emits animated token for animated custom emoji', () => {
    const onSelect = vi.fn();
    render(<EmojiPicker guildEmojis={guildEmojis} onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(screen.getByTitle(':dance:'));
    expect(onSelect).toHaveBeenCalledWith('<a:dance:222>');
  });

  it('Standard tab emits unicode characters', () => {
    const onSelect = vi.fn();
    render(<EmojiPicker guildEmojis={[]} onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(screen.getByTitle(':fire:'));
    expect(onSelect).toHaveBeenCalledWith('🔥');
  });

  it('search filters by name', () => {
    render(<EmojiPicker guildEmojis={[]} onSelect={() => {}} onClose={() => {}} />);
    const search = screen.getByPlaceholderText('Search…');
    fireEvent.change(search, { target: { value: 'pizza' } });
    expect(screen.getByTitle(':pizza:')).toBeTruthy();
    expect(screen.queryByTitle(':grin:')).toBeNull();
  });
});
```

- [ ] **Step 2: Add jsdom config** — vitest already routes `src/renderer/**` through jsdom (see existing `vitest.config.ts`). No change needed.

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/renderer/components/__tests__/EmojiPicker.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(emoji-picker): tab switching, token emission, search"
```

---

## Task 18: Final verification

- [ ] **Step 1: Full test suite + typecheck + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: all PASS.

- [ ] **Step 2: Smoke test the full flow**

Run: `npm run dev`. With a real bot connected to a real server, walk through the verification list in the spec section "Verification".

- [ ] **Step 3: Commit any tweaks discovered during smoke test**

```bash
git add -A
git commit -m "chore: smoke-test fixes"  # only if needed
```

---

## Verification checklist (matches the spec)

- [ ] Server rail: icon-only, hover→circle, tooltip on hover, white pill on selected
- [ ] Channel list: categories collapsible, threads nested, collapsed state survives restart
- [ ] Message history: avatars, author, timestamp, 5-min grouping
- [ ] Markdown: bold/italic/strike/code/blockquote/spoiler/links/mentions/custom-emoji render correctly
- [ ] Embeds: title/description/fields/image render
- [ ] Image attachments render inline; non-image render as a pill that opens externally
- [ ] Infinite scroll up loads older messages, scroll position preserved
- [ ] Live messageCreate appends; live messageUpdate patches; live messageDelete removes
- [ ] "Jump to present" pill appears when scrolled up and a new message arrives
- [ ] Composer: Enter sends, Shift+Enter newline, disabled banner when gateway offline
- [ ] Composer: paperclip opens file picker, multi-select, files queued
- [ ] Composer: drag files onto channel pane → "Drop to attach" overlay → files queued
- [ ] Composer: >25MB files rejected with toast; >10 files rejected with toast
- [ ] Emoji picker: Server tab lists custom emoji and inserts `<:name:id>` (or `<a:name:id>`)
- [ ] Emoji picker: Standard tab inserts unicode chars; search filters both tabs
- [ ] All tests pass: markdown (15), use-channel-messages (7), EmojiPicker (4), plus existing 16 = 42 total
