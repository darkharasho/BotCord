import type {
  BotIdentity, BotStatus, ChannelSummary, DraftInput, DraftRow,
  EmbedPayload, GatewayState, GuildEmoji, GuildSummary, MemberSummary, MessageSummary, PollPayload, Prefs, SendAttachment,
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
    searchMembers(guildId: string, query: string, limit?: number): Promise<Result<MemberSummary[]>>;
  };
  messages: {
    send(channelId: string, content: string): Promise<Result<MessageSummary>>;
    sendEmbed(channelId: string, embed: EmbedPayload, content?: string): Promise<Result<MessageSummary>>;
    sendWithAttachments(
      channelId: string,
      content: string,
      attachments: SendAttachment[],
    ): Promise<Result<MessageSummary>>;
    sendPoll(channelId: string, poll: PollPayload): Promise<Result<MessageSummary>>;
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
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    platform(): Promise<NodeJS.Platform>;
    onMaximizeChange(cb: (maximized: boolean) => void): () => void;
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
  'guilds.searchMembers': 'guilds.searchMembers',
  'messages.send': 'messages.send',
  'messages.sendEmbed': 'messages.sendEmbed',
  'messages.sendWithAttachments': 'messages.sendWithAttachments',
  'messages.sendPoll': 'messages.sendPoll',
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
  'window.minimize': 'window.minimize',
  'window.toggleMaximize': 'window.toggleMaximize',
  'window.close': 'window.close',
  'window.isMaximized': 'window.isMaximized',
  'window.platform': 'window.platform',
  'event.windowMaximizeChange': 'event.windowMaximizeChange',
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
