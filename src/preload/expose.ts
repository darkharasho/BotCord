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
    searchMembers: (guildId, query, opts) => invoke(IPC_CHANNELS['guilds.searchMembers'], guildId, query, opts),
    listChannelMembers: (guildId, channelId) => invoke(IPC_CHANNELS['guilds.listChannelMembers'], guildId, channelId),
    getMember: (guildId, userId) => invoke(IPC_CHANNELS['guilds.getMember'], guildId, userId),
    getForum: (guildId, forumId) => invoke(IPC_CHANNELS['guilds.getForum'], guildId, forumId),
    listArchivedForumPosts: (guildId, forumId) => invoke(IPC_CHANNELS['guilds.listArchivedForumPosts'], guildId, forumId),
    listGuildRoles: (guildId) => invoke(IPC_CHANNELS['guilds.listGuildRoles'], guildId),
    getBotCapabilities: (guildId, targetUserId) => invoke(IPC_CHANNELS['guilds.getBotCapabilities'], guildId, targetUserId),
    assignRole: (guildId, userId, roleId) => invoke(IPC_CHANNELS['guilds.assignRole'], guildId, userId, roleId),
    removeRole: (guildId, userId, roleId) => invoke(IPC_CHANNELS['guilds.removeRole'], guildId, userId, roleId),
    kickMember: (guildId, userId, reason) => invoke(IPC_CHANNELS['guilds.kickMember'], guildId, userId, reason),
    banMember: (guildId, userId, opts) => invoke(IPC_CHANNELS['guilds.banMember'], guildId, userId, opts),
    timeoutMember: (guildId, userId, durationMs, reason) => invoke(IPC_CHANNELS['guilds.timeoutMember'], guildId, userId, durationMs, reason),
    listAllMembers: (guildId) => invoke(IPC_CHANNELS['guilds.listAllMembers'], guildId),
    bulkAssignRole: (guildId, userIds, roleId) => invoke(IPC_CHANNELS['guilds.bulkAssignRole'], guildId, userIds, roleId),
    bulkRemoveRole: (guildId, userIds, roleId) => invoke(IPC_CHANNELS['guilds.bulkRemoveRole'], guildId, userIds, roleId),
    bulkKickMembers: (guildId, userIds, reason) => invoke(IPC_CHANNELS['guilds.bulkKickMembers'], guildId, userIds, reason),
    bulkBanMembers: (guildId, userIds, opts) => invoke(IPC_CHANNELS['guilds.bulkBanMembers'], guildId, userIds, opts),
  },
  messages: {
    send: (channelId, content, opts) => invoke(IPC_CHANNELS['messages.send'], channelId, content, opts),
    sendEmbed: (channelId, embed, content) =>
      invoke(IPC_CHANNELS['messages.sendEmbed'], channelId, embed, content),
    sendWithAttachments: (channelId, content, attachments, opts) =>
      invoke(IPC_CHANNELS['messages.sendWithAttachments'], channelId, content, attachments, opts),
    sendPoll: (channelId, poll) => invoke(IPC_CHANNELS['messages.sendPoll'], channelId, poll),
    fetchPollVoters: (channelId, messageId, answerId) => invoke(IPC_CHANNELS['messages.fetchPollVoters'], channelId, messageId, answerId),
    history: (channelId, opts) => invoke(IPC_CHANNELS['messages.history'], channelId, opts),
    delete: (channelId, messageId) => invoke(IPC_CHANNELS['messages.delete'], channelId, messageId),
    bulkDelete: (channelId, ids) => invoke(IPC_CHANNELS['messages.bulkDelete'], channelId, ids),
    edit: (channelId, messageId, content) => invoke(IPC_CHANNELS['messages.edit'], channelId, messageId, content),
    listPinned: (channelId) => invoke(IPC_CHANNELS['messages.listPinned'], channelId),
    pin: (channelId, messageId) => invoke(IPC_CHANNELS['messages.pin'], channelId, messageId),
    unpin: (channelId, messageId) => invoke(IPC_CHANNELS['messages.unpin'], channelId, messageId),
    createForumPost: (forumId, payload) => invoke(IPC_CHANNELS['messages.createForumPost'], forumId, payload),
    toggleReaction: (channelId, messageId, emoji) => invoke(IPC_CHANNELS['messages.toggleReaction'], channelId, messageId, emoji),
    fetchReactionUsers: (channelId, messageId, emoji) => invoke(IPC_CHANNELS['messages.fetchReactionUsers'], channelId, messageId, emoji),
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
    onForumPostUpdate: (cb) => subscribe(IPC_CHANNELS['event.forumPostUpdate'], cb as (p: unknown) => void),
    onForumPostDelete: (cb) => subscribe(IPC_CHANNELS['event.forumPostDelete'], cb as (p: unknown) => void),
    onTypingStart: (cb) => subscribe(IPC_CHANNELS['event.typingStart'], cb as (p: unknown) => void),
    onSystemContextMenu: (cb) => subscribe(IPC_CHANNELS['event.systemContextMenu'], cb as (p: unknown) => void),
  },
  system: {
    appVersion: () => invoke(IPC_CHANNELS['system.appVersion']),
    openExternal: (url) => invoke(IPC_CHANNELS['system.openExternal'], url),
    editAction: (action) => invoke(IPC_CHANNELS['system.editAction'], action),
    replaceMisspelling: (word) => invoke(IPC_CHANNELS['system.replaceMisspelling'], word),
    addToDictionary: (word) => invoke(IPC_CHANNELS['system.addToDictionary'], word),
    copyText: (text) => invoke(IPC_CHANNELS['system.copyText'], text),
  },
  window: {
    minimize: () => invoke(IPC_CHANNELS['window.minimize']),
    toggleMaximize: () => invoke(IPC_CHANNELS['window.toggleMaximize']),
    close: () => invoke(IPC_CHANNELS['window.close']),
    isMaximized: () => invoke(IPC_CHANNELS['window.isMaximized']),
    platform: () => invoke(IPC_CHANNELS['window.platform']),
    onMaximizeChange: (cb) => subscribe(IPC_CHANNELS['event.windowMaximizeChange'], cb as (p: unknown) => void),
  },
  update: {
    getVersion: () => invoke(IPC_CHANNELS['update.getVersion']),
    check: () => ipcRenderer.send(IPC_CHANNELS['update.check']),
    install: () => ipcRenderer.send(IPC_CHANNELS['update.install']),
    onStatus: (cb) => subscribe(IPC_CHANNELS['event.updateStatus'], cb as (p: unknown) => void),
    onAvailable: (cb) => subscribe(IPC_CHANNELS['event.updateAvailable'], cb as (p: unknown) => void),
    onProgress: (cb) => subscribe(IPC_CHANNELS['event.updateProgress'], cb as (p: unknown) => void),
    onDownloaded: (cb) => subscribe(IPC_CHANNELS['event.updateDownloaded'], cb as (p: unknown) => void),
    onError: (cb) => subscribe(IPC_CHANNELS['event.updateError'], cb as (p: unknown) => void),
  },
};

contextBridge.exposeInMainWorld('botcord', api);
