import { ipcMain } from 'electron';
import { EmbedBuilder, AttachmentBuilder, ChannelType, type Message, type ForumChannel, type MediaChannel } from 'discord.js';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { CreateForumPostPayload, EmbedPayload, ForumPostSummary, MessageSummary, PollPayload, PollVoter, SendAttachment } from '../../shared/domain';
import { projectForumPost, summarizeMessage } from '../discord/client-manager';
import type { IpcDeps } from './index';

type SendOpts = {
  content?: string | undefined;
  embeds?: EmbedBuilder[];
  files?: AttachmentBuilder[];
  reply?: { messageReference: string; failIfNotExists: boolean };
  poll?: {
    question: { text: string };
    answers: Array<{ text: string; emoji?: string }>;
    duration: number;
    allowMultiselect: boolean;
  };
};

const replyOption = (opts: unknown): { messageReference: string; failIfNotExists: boolean } | undefined => {
  if (typeof opts !== 'object' || opts === null) return undefined;
  const r = (opts as { replyToMessageId?: unknown }).replyToMessageId;
  if (typeof r !== 'string' || !r) return undefined;
  return { messageReference: r, failIfNotExists: false };
};

type SendableChannel = {
  send: (opts: SendOpts) => Promise<Message>;
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

  ipcMain.handle(IPC_CHANNELS['messages.send'], async (_, channelId: unknown, content: unknown, opts: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof content !== 'string') return err('INTERNAL', 'invalid arguments');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    const sendOpts: SendOpts = { content };
    const reply = replyOption(opts);
    if (reply) sendOpts.reply = reply;
    try {
      const msg = await (got as { ok: true; channel: SendableChannel }).channel.send(sendOpts);
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

  ipcMain.handle(IPC_CHANNELS['messages.editEmbed'], async (_, channelId: unknown, messageId: unknown, embed: unknown, content?: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof messageId !== 'string' || typeof embed !== 'object' || embed === null) {
      return err('INTERNAL', 'invalid arguments');
    }
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    const channel = (got as { ok: true; channel: SendableChannel }).channel;
    try {
      const msg = await channel.messages.fetch(messageId);
      const updated = await msg.edit({
        content: typeof content === 'string' ? content : '',
        embeds: [buildEmbed(embed as EmbedPayload)],
      });
      return ok(summarizeMessage(updated));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.sendWithAttachments'], async (_, channelId: unknown, content: unknown, attachments: unknown, opts: unknown): Promise<Result<MessageSummary>> => {
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

    const sendOpts: SendOpts = { files };
    if (content.length > 0) sendOpts.content = content;
    const reply = replyOption(opts);
    if (reply) sendOpts.reply = reply;

    try {
      const msg = await (got as { ok: true; channel: SendableChannel }).channel.send(sendOpts);
      return ok(summarizeMessage(msg));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.sendPoll'], async (_, channelId: unknown, payload: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof payload !== 'object' || payload === null) return err('INTERNAL', 'invalid arguments');
    const p = payload as PollPayload;
    if (typeof p.question !== 'string' || p.question.trim().length === 0) return err('INTERNAL', 'poll question is required');
    if (!Array.isArray(p.answers) || p.answers.length < 2 || p.answers.length > 10) return err('INTERNAL', 'poll requires 2-10 answers');
    for (const a of p.answers) {
      if (typeof a?.text !== 'string' || a.text.trim().length === 0) return err('INTERNAL', 'each poll answer needs text');
    }
    if (typeof p.durationHours !== 'number' || p.durationHours < 1 || p.durationHours > 32 * 24) return err('INTERNAL', 'invalid poll duration');

    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    try {
      const msg = await (got as { ok: true; channel: SendableChannel }).channel.send({
        poll: {
          question: { text: p.question.trim() },
          answers: p.answers.map(a => a.emoji ? { text: a.text.trim(), emoji: a.emoji } : { text: a.text.trim() }),
          duration: p.durationHours,
          allowMultiselect: !!p.allowMultiselect,
        },
      });
      return ok(summarizeMessage(msg));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.fetchPollVoters'], async (_, channelId: unknown, messageId: unknown, answerId: unknown): Promise<Result<PollVoter[]>> => {
    if (typeof channelId !== 'string' || typeof messageId !== 'string' || typeof answerId !== 'number') {
      return err('INTERNAL', 'invalid arguments');
    }
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<PollVoter[]>;
    const channel = (got as { ok: true; channel: SendableChannel }).channel;
    try {
      const msg = await channel.messages.fetch(messageId);
      const poll = (msg as unknown as { poll: { answers: Map<number, { voters: { fetch: (opts?: { limit?: number }) => Promise<Map<string, { id: string; username: string; globalName: string | null; displayAvatarURL: (o?: { size: number }) => string }>> } }> } | null }).poll;
      if (!poll) return err('NOT_FOUND', 'No poll on this message');
      const answer = poll.answers.get(answerId);
      if (!answer) return err('NOT_FOUND', `Answer ${answerId} not found`);
      const voters = await answer.voters.fetch({ limit: 100 });
      const guild = (msg as unknown as { guild: { members: { cache: Map<string, { displayName: string; displayHexColor: string }> } } | null }).guild;
      const out: PollVoter[] = Array.from(voters.values()).map(u => {
        const member = guild?.members.cache.get(u.id);
        return {
          id: u.id,
          displayName: member?.displayName ?? u.globalName ?? u.username,
          username: u.username,
          avatarUrl: u.displayAvatarURL({ size: 64 }),
          roleColor: member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null,
        };
      });
      return ok(out);
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
      const list = Array.from(messages.values());

      // Hydrate guild members so role colors / nicknames project correctly on history messages.
      const guild = list.find(m => m.guild)?.guild ?? null;
      if (guild) {
        const missing = Array.from(new Set(list.filter(m => !m.member && m.guild).map(m => m.author.id)));
        if (missing.length > 0) {
          await guild.members.fetch({ user: missing }).catch(() => { /* permissions etc — fall through */ });
        }
      }

      // Pre-warm referenced messages so reply previews render immediately.
      const replyTargets = list
        .map(m => m.reference?.messageId)
        .filter((id): id is string => !!id && !messages.has(id));
      const channel = (got as { ok: true; channel: SendableChannel }).channel;
      await Promise.all(replyTargets.map(id => channel.messages.fetch(id).catch(() => null)));

      return ok(list.map(summarizeMessage));
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

  ipcMain.handle(IPC_CHANNELS['messages.fetchReactionUsers'], async (_, channelId: unknown, messageId: unknown, emoji: unknown): Promise<Result<{ id: string; displayName: string; avatarUrl: string | null }[]>> => {
    if (typeof channelId !== 'string' || typeof messageId !== 'string') return err('INTERNAL', 'channelId and messageId required');
    const e = (emoji && typeof emoji === 'object' ? emoji : null) as { id?: unknown; name?: unknown } | null;
    if (!e || typeof e.name !== 'string') return err('INTERNAL', 'emoji.name required');
    const cacheKey = typeof e.id === 'string' && e.id.length > 0 ? e.id : e.name;

    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const ch = client.channels.cache.get(channelId);
    if (!ch || !('messages' in ch)) return err('NOT_FOUND', `Channel ${channelId} not found`);
    try {
      const msg = await (ch as { messages: { fetch: (id: string) => Promise<Message> } }).messages.fetch(messageId);
      const reaction = msg.reactions.cache.get(cacheKey);
      if (!reaction) return ok([]);
      const users = await reaction.users.fetch({ limit: 100 });
      const guild = msg.guild;
      const out = Array.from(users.values()).map(u => {
        const member = guild?.members.cache.get(u.id);
        const displayName = member?.displayName ?? (u as unknown as { globalName?: string | null }).globalName ?? u.username;
        return { id: u.id, displayName, avatarUrl: u.displayAvatarURL({ size: 64 }) };
      });
      return ok(out);
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.toggleReaction'], async (_, channelId: unknown, messageId: unknown, emoji: unknown): Promise<Result<void>> => {
    if (typeof channelId !== 'string' || typeof messageId !== 'string') return err('INTERNAL', 'channelId and messageId required');
    const e = (emoji && typeof emoji === 'object' ? emoji : null) as { id?: unknown; name?: unknown; animated?: unknown } | null;
    if (!e || typeof e.name !== 'string' || e.name.length === 0) return err('INTERNAL', 'emoji.name required');
    const emojiId = typeof e.id === 'string' && e.id.length > 0 ? e.id : null;
    const emojiName = e.name;
    // discord.js accepts a unicode char OR `<:name:id>` / `<a:name:id>` for
    // custom emoji as the resolvable. The reactions cache also keys on these.
    const animated = e.animated === true;
    const resolvable = emojiId
      ? `${animated ? 'a' : ''}:${emojiName}:${emojiId}`
      : emojiName;
    const cacheKey = emojiId ?? emojiName;

    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const ch = client.channels.cache.get(channelId);
    if (!ch || !('messages' in ch)) return err('NOT_FOUND', `Channel ${channelId} not found`);
    try {
      const msg = await (ch as { messages: { fetch: (id: string) => Promise<Message> } }).messages.fetch(messageId);
      const existing = msg.reactions.cache.get(cacheKey);
      if (existing && existing.me) {
        // Remove the bot's own reaction. Use users.remove() with the bot id
        // since reaction.remove() removes ALL users (admin-only behavior).
        await existing.users.remove(client.user!.id);
      } else {
        await msg.react(resolvable);
      }
      return ok(undefined);
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.createForumPost'], async (_, forumId: unknown, payload: unknown): Promise<Result<ForumPostSummary>> => {
    if (typeof forumId !== 'string') return err('INTERNAL', 'forumId must be a string');
    const p = (payload && typeof payload === 'object' ? payload : {}) as Partial<CreateForumPostPayload>;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const content = typeof p.content === 'string' ? p.content : '';
    const appliedTagIds = Array.isArray(p.appliedTagIds)
      ? p.appliedTagIds.filter((v): v is string => typeof v === 'string')
      : [];
    if (name.length === 0 || name.length > 100) return err('INTERNAL', 'name must be 1–100 characters');
    if (content.trim().length === 0) return err('INTERNAL', 'content is required');

    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const ch = client.channels.cache.get(forumId);
    if (!ch || (ch.type !== ChannelType.GuildForum && ch.type !== ChannelType.GuildMedia)) {
      return err('NOT_FOUND', `Forum ${forumId} not found`);
    }
    try {
      const forum = ch as ForumChannel | MediaChannel;
      const thread = await forum.threads.create({
        name,
        message: { content },
        appliedTags: appliedTagIds,
      });
      return ok(projectForumPost(thread));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.listPinned'], async (_, channelId: unknown): Promise<Result<MessageSummary[]>> => {
    if (typeof channelId !== 'string') return err('INTERNAL', 'channelId required');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const ch = client.channels.cache.get(channelId);
    if (!ch || !('messages' in ch)) return err('NOT_FOUND', `Channel ${channelId} not found`);
    try {
      const pinnedManager = (ch as { messages: { fetchPinned?: () => Promise<Map<string, Message>> } }).messages;
      if (!pinnedManager.fetchPinned) return ok([]);
      const pinned = await pinnedManager.fetchPinned();
      // Discord returns pinned in pin-order (most-recently pinned first); we
      // preserve that ordering for the dropdown.
      return ok(Array.from(pinned.values()).map(summarizeMessage));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.pin'], async (_, channelId: unknown, messageId: unknown): Promise<Result<void>> => {
    if (typeof channelId !== 'string' || typeof messageId !== 'string') return err('INTERNAL', 'channelId and messageId required');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<void>;
    const channel = (got as { ok: true; channel: SendableChannel }).channel;
    try {
      const msg = await channel.messages.fetch(messageId);
      await msg.pin();
      return ok(undefined);
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.unpin'], async (_, channelId: unknown, messageId: unknown): Promise<Result<void>> => {
    if (typeof channelId !== 'string' || typeof messageId !== 'string') return err('INTERNAL', 'channelId and messageId required');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<void>;
    const channel = (got as { ok: true; channel: SendableChannel }).channel;
    try {
      const msg = await channel.messages.fetch(messageId);
      await msg.unpin();
      return ok(undefined);
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.edit'], async (_, channelId: unknown, messageId: unknown, content: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof messageId !== 'string') return err('INTERNAL', 'channelId and messageId required');
    if (typeof content !== 'string') return err('INTERNAL', 'content must be a string');
    if (content.length > 2000) return err('INTERNAL', 'content exceeds 2000 characters');

    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    const channel = (got as { ok: true; channel: SendableChannel }).channel;
    try {
      const msg = await channel.messages.fetch(messageId);
      const updated = await msg.edit({ content });
      return ok(summarizeMessage(updated));
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
