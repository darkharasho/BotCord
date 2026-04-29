import { Client, Events, Partials } from 'discord.js';
import type { Message } from 'discord.js';
import type { BotIdentity, BotStatus, GatewayState, GuildSummary, ChannelSummary, ChannelKind, MessageSummary, MessageAttachment, MessageEmbedSummary, ResolvedMention, GuildEmoji, SystemMessageKind, PollSummary } from '../../shared/domain';
import { MessageType } from 'discord.js';
import { REQUIRED_INTENTS } from './intents';
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
import type { TokenVault } from '../vault/token-vault';

export type ClientManager = {
  getStatus(): BotStatus;
  getClient(): Client | null;
  connect(): Promise<{ ok: true; identity: BotIdentity } | { ok: false; reason: 'INVALID_TOKEN' | 'MISSING_INTENTS' | 'INTERNAL'; message: string }>;
  disconnect(): Promise<void>;
};

export function createClientManager(vault: TokenVault): ClientManager {
  let client: Client | null = null;
  let identity: BotIdentity | null = null;
  let gateway: GatewayState = { status: 'disconnected', reason: null };
  let reconnectAttempt = 0;

  const getStatus = (): BotStatus =>
    identity
      ? { kind: 'configured', identity, gateway }
      : vault.hasToken()
        ? { kind: 'connecting' }
        : { kind: 'unconfigured' };

  const setGateway = (next: GatewayState) => {
    gateway = next;
    broadcast(GATEWAY_EVENT_CHANNEL, gateway);
    broadcast(BOT_STATUS_CHANNEL, getStatus());
  };

  const toIdentity = (c: Client): BotIdentity => {
    const u = c.user!;
    return {
      id: u.id,
      username: u.username,
      discriminator: u.discriminator,
      avatarUrl: u.displayAvatarURL({ size: 128 }),
    };
  };

  const toGuildSummary = (g: { id: string; name: string; icon: string | null; iconURL: (o?: { size?: number; extension?: 'webp' | 'png' | 'jpg' | 'jpeg' | 'gif' }) => string | null; memberCount: number | null }): GuildSummary => ({
    id: g.id,
    name: g.name,
    // Animated icons start with `a_` — serve as .gif so we can swap to static .webp on hover.
    iconUrl: g.icon?.startsWith('a_')
      ? g.iconURL({ size: 128, extension: 'gif' })
      : g.iconURL({ size: 128 }),
    memberCount: g.memberCount,
  });

  const wireEvents = (c: Client) => {
    c.on(Events.ClientReady, () => {
      identity = toIdentity(c);
      reconnectAttempt = 0;
      setGateway({ status: 'ready', sessionStartedAt: Date.now() });
    });
    c.on(Events.ShardDisconnect, (_, shardId) => {
      setGateway({ status: 'disconnected', reason: `shard ${shardId} disconnected` });
    });
    c.on(Events.ShardReconnecting, () => {
      reconnectAttempt += 1;
      setGateway({ status: 'reconnecting', attempt: reconnectAttempt, lastError: null });
    });
    c.on(Events.ShardError, (e) => {
      setGateway({ status: 'reconnecting', attempt: reconnectAttempt, lastError: e.message });
    });
    c.on(Events.GuildCreate, (g) => broadcast(GUILD_UPDATE_CHANNEL, toGuildSummary(g)));
    c.on(Events.GuildUpdate, (_, g) => broadcast(GUILD_UPDATE_CHANNEL, toGuildSummary(g)));
    c.on(Events.ChannelCreate, (ch) => broadcast(CHANNEL_UPDATE_CHANNEL, projectChannel(coerceChannel(ch))));
    c.on(Events.ChannelUpdate, (_, ch) => broadcast(CHANNEL_UPDATE_CHANNEL, projectChannel(coerceChannel(ch))));
    c.on(Events.MessageCreate, (m) => {
      broadcast(MESSAGE_CREATE_CHANNEL, { channelId: m.channelId, message: summarizeMessage(m) });
    });
    c.on(Events.MessageUpdate, (_old, mNew) => {
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
  };

  return {
    getStatus,
    getClient: () => client,

    async connect() {
      const token = await vault.readToken();
      if (!token) return { ok: false, reason: 'INVALID_TOKEN', message: 'No token in vault' };

      client = new Client({
        intents: REQUIRED_INTENTS,
        partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.Reaction],
      });
      wireEvents(client);
      setGateway({ status: 'connecting' });

      try {
        await client.login(token);
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('gateway timeout')), 30_000);
          client!.once(Events.ClientReady, () => { clearTimeout(timeout); resolve(); });
          client!.once(Events.Error, (e) => { clearTimeout(timeout); reject(e); });
        });
        return { ok: true, identity: identity! };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        await this.disconnect();
        if (/disallowed intents/i.test(message)) {
          return { ok: false, reason: 'MISSING_INTENTS', message };
        }
        if (/token/i.test(message) && /invalid/i.test(message)) {
          return { ok: false, reason: 'INVALID_TOKEN', message };
        }
        return { ok: false, reason: 'INTERNAL', message };
      }
    },

    async disconnect() {
      if (client) {
        try { client.removeAllListeners(); client.destroy(); } catch { /* ignore */ }
      }
      client = null;
      identity = null;
      reconnectAttempt = 0;
      setGateway({ status: 'disconnected', reason: null });
    },
  };
}

export function projectChannel(ch: { id: string; guildId: string | null; name: string | null; type: number; parentId: string | null; position?: number; topic?: string | null }): ChannelSummary {
  return {
    id: ch.id,
    guildId: ch.guildId ?? '',
    name: ch.name ?? '(unnamed)',
    type: mapType(ch.type),
    parentId: ch.parentId ?? null,
    position: ch.position ?? 0,
    topic: ch.topic ?? null,
  };
}

function coerceChannel(ch: { id: string; type: number }): { id: string; guildId: string | null; name: string | null; type: number; parentId: string | null; position?: number; topic?: string | null } {
  const c = ch as { id: string; type: number; guildId?: string | null; name?: string | null; parentId?: string | null; position?: number; topic?: string | null };
  return {
    id: c.id,
    type: c.type,
    guildId: typeof c.guildId === 'string' ? c.guildId : null,
    name: typeof c.name === 'string' ? c.name : null,
    parentId: typeof c.parentId === 'string' ? c.parentId : null,
    position: typeof c.position === 'number' ? c.position : 0,
    topic: typeof c.topic === 'string' ? c.topic : null,
  };
}

function mapType(t: number): ChannelKind {
  switch (t) {
    case 0: return 'text';
    case 2: return 'voice';
    case 4: return 'category';
    case 5: return 'announcement';
    case 11:
    case 12: return 'thread';
    case 15: return 'forum';
    default: return 'other';
  }
}

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
    type: (e.data as { type?: string } | undefined)?.type ?? null,
    title: e.title ?? null,
    description: e.description ?? null,
    url: e.url ?? null,
    color: e.color ?? null,
    image: e.image ? { url: e.image.url, width: e.image.width ?? null, height: e.image.height ?? null } : null,
    thumbnail: e.thumbnail ? { url: e.thumbnail.url, width: e.thumbnail.width ?? null, height: e.thumbnail.height ?? null } : null,
    author: e.author ? { name: e.author.name, url: e.author.url ?? null, iconUrl: e.author.iconURL ?? null } : null,
    footer: e.footer ? { text: e.footer.text, iconUrl: e.footer.iconURL ?? null } : null,
    provider: e.provider ? { name: e.provider.name ?? '', url: e.provider.url ?? null } : null,
    timestamp: e.timestamp ? new Date(e.timestamp).getTime() : null,
    video: e.video ? { url: e.video.url ?? '', width: e.video.width ?? null, height: e.video.height ?? null } : null,
    fields: e.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline ?? false })),
  }));

  const mentions: ResolvedMention[] = [];
  m.mentions.users.forEach(u => mentions.push({ type: 'user', id: u.id, name: u.username }));
  m.mentions.channels.forEach(c => mentions.push({ type: 'channel', id: c.id, name: 'name' in c && typeof c.name === 'string' ? c.name : 'channel' }));
  m.mentions.roles.forEach(r => mentions.push({ type: 'role', id: r.id, name: r.name }));

  const authorTag = `${m.author.username}${m.author.discriminator && m.author.discriminator !== '0' ? '#' + m.author.discriminator : ''}`;
  const authorDisplayName =
    (m.member && typeof m.member.displayName === 'string' && m.member.displayName.length > 0 ? m.member.displayName : null)
    ?? (typeof (m.author as { globalName?: string | null }).globalName === 'string' && (m.author as { globalName?: string | null }).globalName!.length > 0
        ? (m.author as { globalName: string }).globalName
        : null)
    ?? m.author.username;

  let authorRoleColor: string | null = null;
  let authorTopRoleName: string | null = null;
  if (m.member) {
    const hex = m.member.displayHexColor;
    if (hex && hex !== '#000000') authorRoleColor = hex;
    const topColored = m.member.roles.color;
    if (topColored) authorTopRoleName = topColored.name;
  }

  return {
    id: m.id,
    channelId: m.channelId,
    guildId: m.guildId ?? null,
    authorId: m.author.id,
    authorTag,
    authorDisplayName,
    authorAvatarUrl: m.author.displayAvatarURL({ size: 64 }),
    authorRoleColor,
    authorTopRoleName,
    content: m.content,
    createdAt: m.createdTimestamp,
    editedAt: m.editedTimestamp,
    hasEmbeds: embeds.length > 0,
    hasAttachments: attachments.length > 0,
    attachments,
    embeds,
    mentions,
    replyTo: projectReplyTo(m),
    systemKind: classifySystemMessage(m.type, m.system),
    poll: projectPoll(m.poll),
  };
}

function projectReplyTo(m: Message): MessageSummary['replyTo'] {
  const refId = m.reference?.messageId;
  if (!refId) return null;
  // Cache-only — keeps history projection fast. The handler bulk-pre-warms
  // referenced messages before calling summarize so this almost always hits.
  const ref = m.channel.messages.cache.get(refId);
  if (!ref) {
    return { id: refId, authorDisplayName: null, authorAvatarUrl: null, authorRoleColor: null, content: null };
  }
  const member = ref.member;
  return {
    id: refId,
    authorDisplayName: member?.displayName ?? ref.author.globalName ?? ref.author.username,
    authorAvatarUrl: ref.author.displayAvatarURL({ size: 32 }),
    authorRoleColor: member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null,
    content: ref.content,
  };
}

function projectPoll(p: { question: { text: string | null }; answers: Map<number, { id: number; text: string | null; emoji: { name: string | null; id: string | null; animated: boolean | null } | null; voteCount: number }>; allowMultiselect: boolean; expiresTimestamp: number | null; resultsFinalized: boolean } | null): PollSummary | null {
  if (!p) return null;
  const answers = Array.from(p.answers.values()).map(a => ({
    id: a.id,
    text: a.text ?? '',
    emoji: a.emoji
      ? (a.emoji.id
          ? `<${a.emoji.animated ? 'a' : ''}:${a.emoji.name ?? 'emoji'}:${a.emoji.id}>`
          : a.emoji.name ?? null)
      : null,
    voteCount: a.voteCount,
  }));
  const totalVotes = answers.reduce((sum, a) => sum + a.voteCount, 0);
  return {
    question: p.question.text ?? '',
    answers,
    totalVotes,
    allowMultiselect: p.allowMultiselect,
    expiresAt: p.expiresTimestamp,
    resultsFinalized: p.resultsFinalized,
  };
}

function classifySystemMessage(type: MessageType, isSystem: boolean | null): SystemMessageKind | null {
  if (!isSystem && type === MessageType.Default) return null;
  if (!isSystem && type === MessageType.Reply) return null;
  switch (type) {
    case MessageType.UserJoin: return 'user_join';
    case MessageType.ChannelPinnedMessage: return 'pin';
    case MessageType.GuildBoost:
    case MessageType.GuildBoostTier1:
    case MessageType.GuildBoostTier2:
    case MessageType.GuildBoostTier3: return 'boost';
    case MessageType.ChannelFollowAdd: return 'channel_follow';
    case MessageType.ThreadCreated:
    case MessageType.ThreadStarterMessage: return 'thread_create';
    case MessageType.RecipientAdd: return 'recipient_add';
    default: return isSystem ? 'other' : null;
  }
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
