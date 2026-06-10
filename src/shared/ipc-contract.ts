import type {
  AllMembersEntry, BotIdentity, BotStatus, BotCapabilities, BulkActionResult, ChannelMemberSummary, ChannelSummary, CreateForumPostPayload, DMChannelRow, DraftInput, DraftRow,
  EmbedPayload, ForumChannelDetail, ForumPostSummary, GatewayState, GlobalAutonomyConfig, GuildAutonomyConfig, GuildEmoji, GuildRole, GuildSummary, ListAllMembersResult,
  MemberDetail, MemberSummary, MessageSummary, PollPayload, PollVoter, Prefs, SendAttachment, VoiceConnectionState,
} from './domain';
import type { Result } from './errors';

export type AutonomyUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  runCount: number;
};

export type AutonomyUsageTotalsByKind = {
  autonomous: AutonomyUsageTotals;
  draft: AutonomyUsageTotals;
  combined: AutonomyUsageTotals;
};

export type AutonomyGuildUsageView = {
  guildId: string;       // raw id, '__dm__' for DMs
  guildName: string;     // resolved display name
  lifetime: AutonomyUsageTotalsByKind;
  last7d: AutonomyUsageTotalsByKind;
};

export type AutonomyUsageStatsView = {
  lifetime: AutonomyUsageTotalsByKind;
  last7d: AutonomyUsageTotalsByKind;
  perGuild: AutonomyGuildUsageView[];
};

export type SystemContextMenuPayload = {
  x: number;
  y: number;
  selectionText: string;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: {
    canPaste: boolean;
    canCut: boolean;
    canCopy: boolean;
    canSelectAll: boolean;
    canUndo: boolean;
    canRedo: boolean;
  };
};

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
    searchMembers(guildId: string, query: string, opts?: { limit?: number; channelId?: string }): Promise<Result<MemberSummary[]>>;
    listChannelMembers(guildId: string, channelId: string): Promise<Result<ChannelMemberSummary[]>>;
    getMember(guildId: string, userId: string): Promise<Result<MemberDetail>>;
    getForum(guildId: string, forumId: string): Promise<Result<ForumChannelDetail>>;
    listArchivedForumPosts(guildId: string, forumId: string): Promise<Result<ForumPostSummary[]>>;
    listGuildRoles(guildId: string): Promise<Result<GuildRole[]>>;
    getBotCapabilities(guildId: string, targetUserId: string): Promise<Result<BotCapabilities>>;
    assignRole(guildId: string, userId: string, roleId: string): Promise<Result<void>>;
    removeRole(guildId: string, userId: string, roleId: string): Promise<Result<void>>;
    kickMember(guildId: string, userId: string, reason?: string): Promise<Result<void>>;
    banMember(guildId: string, userId: string, opts: { reason?: string; deleteMessageSeconds?: number }): Promise<Result<void>>;
    timeoutMember(guildId: string, userId: string, durationMs: number, reason?: string): Promise<Result<void>>;
    listAllMembers(guildId: string): Promise<Result<ListAllMembersResult>>;
    bulkAssignRole(guildId: string, userIds: string[], roleId: string): Promise<Result<BulkActionResult>>;
    bulkRemoveRole(guildId: string, userIds: string[], roleId: string): Promise<Result<BulkActionResult>>;
    bulkKickMembers(guildId: string, userIds: string[], reason?: string): Promise<Result<BulkActionResult>>;
    bulkBanMembers(guildId: string, userIds: string[], opts: { reason?: string; deleteMessageSeconds?: number }): Promise<Result<BulkActionResult>>;
  };
  messages: {
    send(channelId: string, content: string, opts?: { replyToMessageId?: string }): Promise<Result<MessageSummary>>;
    sendEmbed(channelId: string, embed: EmbedPayload, content?: string): Promise<Result<MessageSummary>>;
    sendWithAttachments(
      channelId: string,
      content: string,
      attachments: SendAttachment[],
      opts?: { replyToMessageId?: string },
    ): Promise<Result<MessageSummary>>;
    sendPoll(channelId: string, poll: PollPayload): Promise<Result<MessageSummary>>;
    fetchPollVoters(channelId: string, messageId: string, answerId: number): Promise<Result<PollVoter[]>>;
    history(channelId: string, opts: { before?: string; limit: number }): Promise<Result<MessageSummary[]>>;
    delete(channelId: string, messageId: string): Promise<Result<void>>;
    bulkDelete(channelId: string, messageIds: string[]): Promise<Result<{ deleted: string[] }>>;
    edit(channelId: string, messageId: string, content: string): Promise<Result<MessageSummary>>;
    editEmbed(channelId: string, messageId: string, embed: EmbedPayload, content?: string): Promise<Result<MessageSummary>>;
    listPinned(channelId: string): Promise<Result<MessageSummary[]>>;
    pin(channelId: string, messageId: string): Promise<Result<void>>;
    unpin(channelId: string, messageId: string): Promise<Result<void>>;
    createForumPost(forumId: string, payload: CreateForumPostPayload): Promise<Result<ForumPostSummary>>;
    toggleReaction(channelId: string, messageId: string, emoji: { id: string | null; name: string; animated?: boolean }): Promise<Result<void>>;
    fetchReactionUsers(channelId: string, messageId: string, emoji: { id: string | null; name: string }): Promise<Result<{ id: string; displayName: string; avatarUrl: string | null }[]>>;
  };
  dms: {
    list(opts?: { includeInert?: boolean }): Promise<Result<DMChannelRow[]>>;
    fetchMessages(channelId: string, opts: { before?: string; limit: number }): Promise<Result<MessageSummary[]>>;
    openWithUser(userId: string): Promise<Result<DMChannelRow>>;
    send(channelId: string, content: string, opts?: { replyToMessageId?: string }): Promise<Result<MessageSummary>>;
    sendWithAttachments(channelId: string, content: string, attachments: SendAttachment[]): Promise<Result<MessageSummary>>;
    markRead(channelId: string): Promise<Result<void>>;
    close(channelId: string): Promise<Result<void>>;
    getMutualGuilds(userId: string): Promise<Result<GuildSummary[]>>;
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
  autonomy: {
    detect(): Promise<{ found: boolean; version?: string; reason?: string }>;
    getGuildConfig(guildId: string): Promise<Result<GuildAutonomyConfig>>;
    setGuildConfig(guildId: string, partial: Partial<Omit<GuildAutonomyConfig, 'guildId' | 'updatedAt'>>): Promise<Result<GuildAutonomyConfig>>;
    getGlobalConfig(): Promise<Result<GlobalAutonomyConfig>>;
    setGlobalConfig(partial: Partial<GlobalAutonomyConfig>): Promise<Result<GlobalAutonomyConfig>>;
    draftReply(channelId: string, messageId: string): Promise<Result<{ requestId: string }>>;
    cancelDraft(requestId: string): Promise<Result<void>>;
    getUsageStats(): Promise<Result<AutonomyUsageStatsView>>;
  };
  tray: {
    setUnreadBadge(hasUnread: boolean): Promise<void>;
  };
  voice: {
    join(guildId: string, channelId: string): Promise<Result<VoiceConnectionState>>;
    leave(): Promise<Result<VoiceConnectionState>>;
    getState(): Promise<VoiceConnectionState>;
    onState(cb: (s: VoiceConnectionState) => void): () => void;
    onFrame(cb: (pcm: ArrayBuffer) => void): () => void;
    onSpeakers(cb: (levels: Record<string, number>) => void): () => void;
    micStart(): void;
    micFrame(pcm: ArrayBuffer): void;
    micStop(): void;
    setPttBinding(accelerator: string | null, useGlobal: boolean, useElectronShortcut: boolean, usePortal: boolean): Promise<{ scope: 'global' | 'app'; downgraded: boolean }>;
    getPttDiagnostics(): Promise<{
      uioStarted: boolean;
      uioStartFailed: boolean;
      isWayland: boolean;
      uioEventCount: number;
      uioLastEvent: { keycode: number; at: number } | null;
      electronShortcutRegistered: boolean;
      electronShortcutEvents: number;
      portalSessionActive: boolean;
      portalLastError: string | null;
      portalActivations: number;
    }>;
    setMute(muted: boolean): Promise<void>;
    onPttHeld(cb: (held: boolean) => void): () => void;
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
    onForumPostUpdate(cb: (p: { forumId: string; post: ForumPostSummary }) => void): () => void;
    onForumPostDelete(cb: (p: { forumId: string; postId: string }) => void): () => void;
    onTypingStart(cb: (p: { channelId: string; userId: string; displayName: string; startedAt: number }) => void): () => void;
    onSystemContextMenu(cb: (p: SystemContextMenuPayload) => void): () => void;
    onAutonomyDraftDelta(cb: (p: { requestId: string; delta: string }) => void): () => void;
    onAutonomyDraftDone(cb: (p: { requestId: string; text: string; stopReason: string | undefined }) => void): () => void;
    onAutonomyThinkingStart(cb: (p: { channelId: string; triggerMessageId: string; botId: string }) => void): () => void;
    onAutonomyThinkingEnd(cb: (p: { channelId: string; triggerMessageId: string }) => void): () => void;
  };
  system: {
    appVersion(): Promise<string>;
    openExternal(url: string): Promise<void>;
    editAction(action: 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo'): Promise<void>;
    replaceMisspelling(word: string): Promise<void>;
    addToDictionary(word: string): Promise<void>;
    copyText(text: string): Promise<void>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    platform(): Promise<NodeJS.Platform>;
    onMaximizeChange(cb: (maximized: boolean) => void): () => void;
  };
  update: {
    getVersion(): Promise<string>;
    check(): void;
    install(): void;
    onStatus(cb: (status: 'checking' | 'up-to-date') => void): () => void;
    onAvailable(cb: (info: { version: string }) => void): () => void;
    onProgress(cb: (info: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void): () => void;
    onDownloaded(cb: (info: { version: string }) => void): () => void;
    onError(cb: (info: { message: string }) => void): () => void;
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
  'guilds.listChannelMembers': 'guilds.listChannelMembers',
  'guilds.getMember': 'guilds.getMember',
  'guilds.getForum': 'guilds.getForum',
  'guilds.listArchivedForumPosts': 'guilds.listArchivedForumPosts',
  'guilds.listGuildRoles': 'guilds.listGuildRoles',
  'guilds.getBotCapabilities': 'guilds.getBotCapabilities',
  'guilds.assignRole': 'guilds.assignRole',
  'guilds.removeRole': 'guilds.removeRole',
  'guilds.kickMember': 'guilds.kickMember',
  'guilds.banMember': 'guilds.banMember',
  'guilds.timeoutMember': 'guilds.timeoutMember',
  'guilds.listAllMembers': 'guilds.listAllMembers',
  'guilds.bulkAssignRole': 'guilds.bulkAssignRole',
  'guilds.bulkRemoveRole': 'guilds.bulkRemoveRole',
  'guilds.bulkKickMembers': 'guilds.bulkKickMembers',
  'guilds.bulkBanMembers': 'guilds.bulkBanMembers',
  'messages.send': 'messages.send',
  'messages.sendEmbed': 'messages.sendEmbed',
  'messages.editEmbed': 'messages.editEmbed',
  'messages.sendWithAttachments': 'messages.sendWithAttachments',
  'messages.sendPoll': 'messages.sendPoll',
  'messages.fetchPollVoters': 'messages.fetchPollVoters',
  'messages.history': 'messages.history',
  'messages.delete': 'messages.delete',
  'messages.bulkDelete': 'messages.bulkDelete',
  'messages.edit': 'messages.edit',
  'messages.listPinned': 'messages.listPinned',
  'messages.pin': 'messages.pin',
  'messages.unpin': 'messages.unpin',
  'messages.createForumPost': 'messages.createForumPost',
  'messages.toggleReaction': 'messages.toggleReaction',
  'messages.fetchReactionUsers': 'messages.fetchReactionUsers',
  'dms.list': 'dms.list',
  'dms.fetchMessages': 'dms.fetchMessages',
  'dms.openWithUser': 'dms.openWithUser',
  'dms.send': 'dms.send',
  'dms.sendWithAttachments': 'dms.sendWithAttachments',
  'dms.markRead': 'dms.markRead',
  'dms.close': 'dms.close',
  'dms.getMutualGuilds': 'dms.getMutualGuilds',
  'drafts.list': 'drafts.list',
  'drafts.upsert': 'drafts.upsert',
  'drafts.delete': 'drafts.delete',
  'prefs.get': 'prefs.get',
  'prefs.set': 'prefs.set',
  'voice.join': 'voice.join',
  'voice.leave': 'voice.leave',
  'voice.getState': 'voice.getState',
  'voice.mic.start': 'voice.mic.start',
  'voice.mic.frame': 'voice.mic.frame',
  'voice.mic.stop': 'voice.mic.stop',
  'voice.setPttBinding': 'voice.setPttBinding',
  'voice.getPttDiagnostics': 'voice.getPttDiagnostics',
  'voice.setMute': 'voice.setMute',
  'event.voiceState': 'event.voiceState',
  'event.voiceFrame': 'event.voiceFrame',
  'event.voiceSpeakers': 'event.voiceSpeakers',
  'event.pttHeld': 'event.pttHeld',
  'system.appVersion': 'system.appVersion',
  'system.openExternal': 'system.openExternal',
  'system.editAction': 'system.editAction',
  'system.replaceMisspelling': 'system.replaceMisspelling',
  'system.addToDictionary': 'system.addToDictionary',
  'system.copyText': 'system.copyText',
  'window.minimize': 'window.minimize',
  'window.toggleMaximize': 'window.toggleMaximize',
  'window.close': 'window.close',
  'window.isMaximized': 'window.isMaximized',
  'window.platform': 'window.platform',
  'update.getVersion': 'update.getVersion',
  'update.check': 'update.check',
  'update.install': 'update.install',
  'event.windowMaximizeChange': 'event.windowMaximizeChange',
  'event.updateStatus': 'event.updateStatus',
  'event.updateAvailable': 'event.updateAvailable',
  'event.updateProgress': 'event.updateProgress',
  'event.updateDownloaded': 'event.updateDownloaded',
  'event.updateError': 'event.updateError',
  'event.botStatus': 'event.botStatus',
  'event.gatewayState': 'event.gatewayState',
  'event.guildUpdate': 'event.guildUpdate',
  'event.channelUpdate': 'event.channelUpdate',
  'event.messageCreate': 'event.messageCreate',
  'event.messageUpdate': 'event.messageUpdate',
  'event.messageDelete': 'event.messageDelete',
  'event.guildEmojisUpdate': 'event.guildEmojisUpdate',
  'event.forumPostUpdate': 'event.forumPostUpdate',
  'event.forumPostDelete': 'event.forumPostDelete',
  'event.typingStart': 'event.typingStart',
  'event.systemContextMenu': 'event.systemContextMenu',
  'autonomy.detect': 'autonomy.detect',
  'autonomy.getGuildConfig': 'autonomy.getGuildConfig',
  'autonomy.setGuildConfig': 'autonomy.setGuildConfig',
  'autonomy.getGlobalConfig': 'autonomy.getGlobalConfig',
  'autonomy.setGlobalConfig': 'autonomy.setGlobalConfig',
  'autonomy.draftReply': 'autonomy.draftReply',
  'autonomy.cancelDraft': 'autonomy.cancelDraft',
  'autonomy.getUsageStats': 'autonomy.getUsageStats',
  'tray.setUnreadBadge': 'tray.setUnreadBadge',
  'event.autonomyDraftDelta': 'event.autonomyDraftDelta',
  'event.autonomyDraftDone': 'event.autonomyDraftDone',
  'event.autonomyThinkingStart': 'event.autonomyThinkingStart',
  'event.autonomyThinkingEnd': 'event.autonomyThinkingEnd',
} as const;

export type IpcChannel = keyof typeof IPC_CHANNELS;

declare global {
  interface Window {
    botcord: BotcordApi;
  }
}
