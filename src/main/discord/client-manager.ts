import { Client, Events, Partials, ChannelType, ChannelFlagsBitField, SnowflakeUtil } from 'discord.js';
import type { Message, VoiceBasedChannel, GuildBasedChannel, ForumChannel, ThreadChannel, MediaChannel, Guild } from 'discord.js';
import type { BotIdentity, BotStatus, GatewayState, GuildSummary, ChannelSummary, ChannelKind, MessageSummary, MessageAttachment, MessageEmbedSummary, ResolvedMention, GuildEmoji, RoleIcon, SystemMessageKind, PollSummary, ReactionSummary, VoiceMemberSummary, ForumTag, ForumPostSummary, ForumChannelDetail } from '../../shared/domain';
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
  FORUM_POST_UPDATE_CHANNEL,
  FORUM_POST_DELETE_CHANNEL,
  TYPING_START_CHANNEL,
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
    c.on(Events.ChannelCreate, (ch) => broadcast(CHANNEL_UPDATE_CHANNEL, projectChannel(coerceChannel(ch), voiceMembersFor(ch as GuildBasedChannel))));
    c.on(Events.ChannelUpdate, (_, ch) => broadcast(CHANNEL_UPDATE_CHANNEL, projectChannel(coerceChannel(ch), voiceMembersFor(ch as GuildBasedChannel))));
    c.on(Events.VoiceStateUpdate, (oldState, newState) => {
      // A voice state change may affect up to two channels: the one the user
      // left (oldState.channel) and the one they joined (newState.channel).
      // Mute/deafen/server-mute/etc. on the same channel collapses to one.
      const seen = new Set<string>();
      const touched: VoiceBasedChannel[] = [];
      for (const ch of [oldState.channel, newState.channel]) {
        if (!ch || seen.has(ch.id)) continue;
        seen.add(ch.id);
        touched.push(ch);
      }
      for (const ch of touched) {
        broadcast(CHANNEL_UPDATE_CHANNEL, projectChannel(coerceChannel(ch), voiceMembersFor(ch)));
      }
    });
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

    // Reactions don't trigger MessageUpdate, so we project the affected
    // message ourselves and reuse the existing message-update channel —
    // the renderer already listens and merges by id. Partial messages get
    // fetched first so the summary is complete (mentions/embeds/etc).
    const broadcastReactionUpdate = async (reaction: { message: Message }) => {
      let msg = reaction.message;
      if (msg.partial) {
        try { msg = await msg.fetch(); } catch { return; }
      }
      broadcast(MESSAGE_UPDATE_CHANNEL, { channelId: msg.channelId, message: summarizeMessage(msg) });
    };
    c.on(Events.MessageReactionAdd, (r) => { void broadcastReactionUpdate(r as unknown as { message: Message }); });
    c.on(Events.MessageReactionRemove, (r) => { void broadcastReactionUpdate(r as unknown as { message: Message }); });
    c.on(Events.MessageReactionRemoveAll, (m) => {
      const msg = m as Message;
      if (msg.partial) {
        msg.fetch().then(full => broadcast(MESSAGE_UPDATE_CHANNEL, { channelId: full.channelId, message: summarizeMessage(full) })).catch(() => { /* ignore */ });
        return;
      }
      broadcast(MESSAGE_UPDATE_CHANNEL, { channelId: msg.channelId, message: summarizeMessage(msg) });
    });
    c.on(Events.MessageReactionRemoveEmoji, (r) => { void broadcastReactionUpdate(r as unknown as { message: Message }); });

    // Poll votes don't fire MessageUpdate either. Re-summarize the parent
    // message and reuse the same renderer channel — discord.js mutates the
    // poll cache before the event fires, so summarizeMessage sees fresh
    // counts. Partials are fetched first the same way as reactions.
    const broadcastPollVote = async (vote: { message: Message } | { messageId?: string; channel?: { messages: { fetch: (id: string) => Promise<Message> } } }) => {
      const v = vote as { message?: Message; messageId?: string; channel?: { messages: { fetch: (id: string) => Promise<Message> } } };
      let msg: Message | null = v.message ?? null;
      if (msg && msg.partial) {
        try { msg = await msg.fetch(); } catch { return; }
      }
      // Some discord.js builds expose the vote payload without `.message`;
      // fall back to fetching by messageId via the channel.
      if (!msg && v.messageId && v.channel) {
        try { msg = await v.channel.messages.fetch(v.messageId); } catch { return; }
      }
      if (!msg) return;
      broadcast(MESSAGE_UPDATE_CHANNEL, { channelId: msg.channelId, message: summarizeMessage(msg) });
    };
    c.on(Events.MessagePollVoteAdd, (vote) => { void broadcastPollVote(vote as unknown as { message: Message }); });
    c.on(Events.MessagePollVoteRemove, (vote) => { void broadcastPollVote(vote as unknown as { message: Message }); });

    // Typing indicator. Discord sends one event when typing starts; the
    // typing state expires after ~10s on the receiving side, so the
    // renderer manages its own timeout.
    c.on(Events.TypingStart, (typing) => {
      const t = typing as unknown as {
        channel: { id: string };
        user: { id: string; username: string; globalName?: string | null };
        member?: { displayName: string } | null;
        startedTimestamp: number;
      };
      const displayName = t.member?.displayName ?? t.user.globalName ?? t.user.username;
      broadcast(TYPING_START_CHANNEL, {
        channelId: t.channel.id,
        userId: t.user.id,
        displayName,
        startedAt: t.startedTimestamp,
      });
    });
    // Forum post lifecycle. A forum post is a thread whose parent is a
    // ForumChannel. We forward create/update/delete on those threads only;
    // regular text-channel threads are not surfaced here (the channel list
    // already handles them via ChannelCreate/Update).
    c.on(Events.ThreadCreate, (thread) => {
      const post = projectForumPostIfApplicable(thread);
      if (post) broadcast(FORUM_POST_UPDATE_CHANNEL, { forumId: post.forumId, post });
    });
    c.on(Events.ThreadUpdate, (_old, threadNew) => {
      const post = projectForumPostIfApplicable(threadNew);
      if (post) broadcast(FORUM_POST_UPDATE_CHANNEL, { forumId: post.forumId, post });
    });
    c.on(Events.ThreadDelete, (thread) => {
      const parent = thread.parent;
      if (!parent || parent.type !== ChannelType.GuildForum) return;
      broadcast(FORUM_POST_DELETE_CHANNEL, { forumId: parent.id, postId: thread.id });
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

export function projectChannel(
  ch: { id: string; guildId: string | null; name: string | null; type: number; parentId: string | null; position?: number; topic?: string | null; lastMessageId?: string | null },
  voiceMembers: VoiceMemberSummary[] | null = null,
): ChannelSummary {
  return {
    id: ch.id,
    guildId: ch.guildId ?? '',
    name: ch.name ?? '(unnamed)',
    type: mapType(ch.type),
    parentId: ch.parentId ?? null,
    position: ch.position ?? 0,
    topic: ch.topic ?? null,
    voiceMembers,
    lastMessageId: ch.lastMessageId ?? null,
  };
}

// Snapshot of who is currently connected to a voice/stage channel. Returns
// null for any non-voice channel so consumers can pass through unconditionally.
export function voiceMembersFor(ch: GuildBasedChannel | VoiceBasedChannel | null | undefined): VoiceMemberSummary[] | null {
  if (!ch) return null;
  if (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice) return null;
  const voice = ch as VoiceBasedChannel;
  return Array.from(voice.members.values())
    .map(m => {
      const v = m.voice;
      return {
        id: m.id,
        displayName: m.displayName,
        avatarUrl: m.user.displayAvatarURL({ size: 64 }),
        roleColor: m.displayHexColor && m.displayHexColor !== '#000000' ? m.displayHexColor : null,
        selfMute: v.selfMute ?? false,
        selfDeaf: v.selfDeaf ?? false,
        serverMute: v.serverMute ?? false,
        serverDeaf: v.serverDeaf ?? false,
      } satisfies VoiceMemberSummary;
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
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
  m.mentions.users.forEach(u => {
    const member = m.guild?.members.cache.get(u.id);
    const name = member?.displayName ?? (u as { globalName?: string | null }).globalName ?? u.username;
    mentions.push({ type: 'user', id: u.id, name });
  });
  m.mentions.channels.forEach(c => mentions.push({ type: 'channel', id: c.id, name: 'name' in c && typeof c.name === 'string' ? c.name : 'channel' }));
  m.mentions.roles.forEach(r => mentions.push({ type: 'role', id: r.id, name: r.name }));

  // Discord's `m.mentions.*` only covers the content text; embed bodies can
  // reference IDs that aren't pinged. Scan every text-bearing field of the
  // message (content + embeds) and resolve any extra IDs from the guild
  // cache so the renderer shows display names everywhere.
  const embedTexts: string[] = [];
  for (const e of m.embeds) {
    if (e.title) embedTexts.push(e.title);
    if (e.description) embedTexts.push(e.description);
    if (e.author?.name) embedTexts.push(e.author.name);
    if (e.footer?.text) embedTexts.push(e.footer.text);
    for (const f of e.fields) { embedTexts.push(f.name); embedTexts.push(f.value); }
  }
  resolveMentionPatterns(m.content, m.guild, mentions);
  for (const t of embedTexts) resolveMentionPatterns(t, m.guild, mentions);

  const authorTag = `${m.author.username}${m.author.discriminator && m.author.discriminator !== '0' ? '#' + m.author.discriminator : ''}`;
  const authorDisplayName =
    (m.member && typeof m.member.displayName === 'string' && m.member.displayName.length > 0 ? m.member.displayName : null)
    ?? (typeof (m.author as { globalName?: string | null }).globalName === 'string' && (m.author as { globalName?: string | null }).globalName!.length > 0
        ? (m.author as { globalName: string }).globalName
        : null)
    ?? m.author.username;

  let authorRoleColor: string | null = null;
  let authorTopRoleName: string | null = null;
  const authorRoleIcons: RoleIcon[] = [];
  if (m.member) {
    const hex = m.member.displayHexColor;
    if (hex && hex !== '#000000') authorRoleColor = hex;
    const topColored = m.member.roles.color;
    if (topColored) authorTopRoleName = topColored.name;
    // Highest-position roles first so the most-prominent icon renders first.
    for (const role of m.member.roles.cache.sort((a, b) => b.position - a.position).values()) {
      const iconUrl = role.iconURL({ size: 32 });
      const unicodeEmoji = role.unicodeEmoji ?? null;
      if (iconUrl || unicodeEmoji) {
        authorRoleIcons.push({ roleId: role.id, roleName: role.name, iconUrl, unicodeEmoji });
      }
    }
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
    authorRoleIcons,
    authorIsBot: m.author.bot ?? false,
    content: m.content,
    createdAt: m.createdTimestamp,
    editedAt: m.editedTimestamp,
    hasEmbeds: embeds.length > 0,
    hasAttachments: attachments.length > 0,
    attachments,
    embeds,
    mentions,
    mentionsEveryone: m.mentions.everyone ?? false,
    replyTo: projectReplyTo(m),
    systemKind: classifySystemMessage(m.type, m.system),
    poll: projectPoll(m.poll),
    reactions: projectReactions(m),
    pinned: m.pinned ?? false,
  };
}

// Scans `text` for Discord mention tokens (<@id>, <@!id>, <@&id>, <#id>)
// and pushes resolved entries into `out`, deduplicated by type+id. Looks up
// names from the guild's member/channel/role caches; falls back to user
// caches and finally to a generic placeholder so the renderer never sees a
// raw snowflake. Tokens already present in `out` are skipped so existing
// authoritative names from `m.mentions.*` win.
function resolveMentionPatterns(text: string, guild: Message['guild'], out: ResolvedMention[]): void {
  if (!text) return;
  const has = (type: ResolvedMention['type'], id: string): boolean =>
    out.some(x => x.type === type && x.id === id);

  // <@id> or <@!id>
  for (const match of text.matchAll(/<@!?(\d+)>/g)) {
    const id = match[1]!;
    if (has('user', id)) continue;
    const member = guild?.members.cache.get(id);
    if (member) {
      out.push({ type: 'user', id, name: member.displayName });
      continue;
    }
    const user = guild?.client.users.cache.get(id);
    if (user) {
      const u = user as unknown as { globalName?: string | null; username: string };
      out.push({ type: 'user', id, name: u.globalName ?? u.username });
      continue;
    }
    out.push({ type: 'user', id, name: 'unknown-user' });
  }
  // <@&id>
  for (const match of text.matchAll(/<@&(\d+)>/g)) {
    const id = match[1]!;
    if (has('role', id)) continue;
    const role = guild?.roles.cache.get(id);
    out.push({ type: 'role', id, name: role?.name ?? 'unknown-role' });
  }
  // <#id>
  for (const match of text.matchAll(/<#(\d+)>/g)) {
    const id = match[1]!;
    if (has('channel', id)) continue;
    const ch = guild?.channels.cache.get(id);
    const name = ch && 'name' in ch && typeof ch.name === 'string' ? ch.name : 'channel';
    out.push({ type: 'channel', id, name });
  }
}

function projectReactions(m: Message): ReactionSummary[] {
  const out: ReactionSummary[] = [];
  for (const r of m.reactions.cache.values()) {
    const e = r.emoji;
    out.push({
      emojiId: e.id ?? null,
      emojiName: e.name ?? '',
      animated: e.animated ?? false,
      count: r.count,
      me: r.me ?? false,
    });
  }
  return out;
}

function projectReplyTo(m: Message): MessageSummary['replyTo'] {
  const refId = m.reference?.messageId;
  if (!refId) return null;
  // Cache-only — keeps history projection fast. The handler bulk-pre-warms
  // referenced messages before calling summarize so this almost always hits.
  const ref = m.channel.messages.cache.get(refId);
  if (!ref) {
    return { id: refId, authorDisplayName: null, authorAvatarUrl: null, authorRoleColor: null, content: null, mentions: [] };
  }
  const member = ref.member;
  const mentions: ResolvedMention[] = [];
  ref.mentions.users.forEach(u => {
    const member = ref.guild?.members.cache.get(u.id);
    const name = member?.displayName ?? (u as { globalName?: string | null }).globalName ?? u.username;
    mentions.push({ type: 'user', id: u.id, name });
  });
  ref.mentions.channels.forEach(c => mentions.push({ type: 'channel', id: c.id, name: 'name' in c && typeof c.name === 'string' ? c.name : 'channel' }));
  ref.mentions.roles.forEach(r => mentions.push({ type: 'role', id: r.id, name: r.name }));
  return {
    id: refId,
    authorDisplayName: member?.displayName ?? ref.author.globalName ?? ref.author.username,
    authorAvatarUrl: ref.author.displayAvatarURL({ size: 32 }),
    authorRoleColor: member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null,
    content: ref.content,
    mentions,
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

export function projectForumTag(t: { id: string; name: string; emoji?: { id?: string | null; name?: string | null } | null; moderated?: boolean }): ForumTag {
  const emoji = t.emoji ?? null;
  const emojiId = emoji?.id ?? null;
  const emojiName = emoji?.name ?? null;
  // Discord packs unicode emoji into `name` (with `id` null) and custom
  // guild emoji into `id`. Splitting them here keeps the renderer logic flat.
  return {
    id: t.id,
    name: t.name,
    emojiId,
    emojiName: emojiId ? emojiName : null,
    emojiUnicode: emojiId ? null : emojiName,
    moderated: t.moderated ?? false,
  };
}

export function projectForumPost(thread: ThreadChannel): ForumPostSummary {
  const parent = thread.parent;
  const guildId = thread.guild?.id ?? parent?.guild?.id ?? '';
  const owner = thread.ownerId ? thread.guild?.members.cache.get(thread.ownerId) : undefined;
  const ownerUser = owner?.user ?? (thread.ownerId ? thread.client.users.cache.get(thread.ownerId) : undefined);
  // discord.js exposes thread.lastMessageId — derive an "active at" timestamp
  // from the snowflake when there's no explicit archived/created marker handy.
  let lastActivityAt = thread.createdTimestamp ?? Date.now();
  if (thread.archiveTimestamp) lastActivityAt = thread.archiveTimestamp;
  else if (thread.lastMessageId) {
    try { lastActivityAt = Number(SnowflakeUtil.timestampFrom(thread.lastMessageId)); } catch { /* keep fallback */ }
  }
  const flags = thread.flags;
  const pinned = flags instanceof ChannelFlagsBitField
    ? flags.has(ChannelFlagsBitField.Flags.Pinned)
    : false;
  return {
    id: thread.id,
    forumId: parent?.id ?? '',
    guildId,
    name: thread.name,
    ownerId: thread.ownerId ?? '',
    ownerDisplayName: owner?.displayName ?? ownerUser?.globalName ?? ownerUser?.username ?? null,
    ownerAvatarUrl: ownerUser?.displayAvatarURL({ size: 64 }) ?? null,
    ownerRoleColor: owner && owner.displayHexColor && owner.displayHexColor !== '#000000' ? owner.displayHexColor : null,
    createdAt: thread.createdTimestamp ?? 0,
    lastActivityAt,
    messageCount: thread.messageCount ?? thread.totalMessageSent ?? 0,
    archived: thread.archived ?? false,
    locked: thread.locked ?? false,
    pinned,
    appliedTagIds: thread.appliedTags ?? [],
  };
}

// Returns null unless the thread's parent is a forum, in which case projects it.
function projectForumPostIfApplicable(thread: ThreadChannel): ForumPostSummary | null {
  const parent = thread.parent;
  if (!parent || parent.type !== ChannelType.GuildForum) return null;
  return projectForumPost(thread);
}

export function projectForumChannel(forum: ForumChannel | MediaChannel): ForumChannelDetail {
  const tags = (forum.availableTags ?? []).map(projectForumTag);
  const posts = Array.from(forum.threads.cache.values())
    .map(t => projectForumPost(t))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActivityAt - a.lastActivityAt);
  const flags = forum.flags;
  const requireTag = flags instanceof ChannelFlagsBitField
    ? flags.has(ChannelFlagsBitField.Flags.RequireTag)
    : false;
  return {
    forumId: forum.id,
    guildId: forum.guildId,
    name: forum.name,
    topic: 'topic' in forum ? (forum.topic ?? null) : null,
    availableTags: tags,
    posts,
    requireTag,
  };
}

// Helper: fetch + project archived posts from a forum (paginated by Discord).
export async function fetchArchivedForumPosts(guild: Guild, forumId: string): Promise<ForumPostSummary[]> {
  const ch = guild.channels.cache.get(forumId);
  if (!ch || ch.type !== ChannelType.GuildForum) return [];
  const forum = ch as ForumChannel;
  try {
    const result = await forum.threads.fetchArchived({ limit: 50 });
    return Array.from(result.threads.values())
      .map(t => projectForumPost(t))
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  } catch {
    return [];
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
