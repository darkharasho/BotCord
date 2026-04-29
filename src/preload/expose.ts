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
  window: {
    minimize: () => invoke(IPC_CHANNELS['window.minimize']),
    toggleMaximize: () => invoke(IPC_CHANNELS['window.toggleMaximize']),
    close: () => invoke(IPC_CHANNELS['window.close']),
    isMaximized: () => invoke(IPC_CHANNELS['window.isMaximized']),
    platform: () => invoke(IPC_CHANNELS['window.platform']),
    onMaximizeChange: (cb) => subscribe(IPC_CHANNELS['event.windowMaximizeChange'], cb as (p: unknown) => void),
  },
};

contextBridge.exposeInMainWorld('botcord', api);
