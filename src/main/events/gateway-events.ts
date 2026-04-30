import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';

export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

export const GATEWAY_EVENT_CHANNEL = IPC_CHANNELS['event.gatewayState'];
export const BOT_STATUS_CHANNEL = IPC_CHANNELS['event.botStatus'];
export const GUILD_UPDATE_CHANNEL = IPC_CHANNELS['event.guildUpdate'];
export const CHANNEL_UPDATE_CHANNEL = IPC_CHANNELS['event.channelUpdate'];
export const MESSAGE_CREATE_CHANNEL = IPC_CHANNELS['event.messageCreate'];
export const MESSAGE_UPDATE_CHANNEL = IPC_CHANNELS['event.messageUpdate'];
export const MESSAGE_DELETE_CHANNEL = IPC_CHANNELS['event.messageDelete'];
export const GUILD_EMOJIS_UPDATE_CHANNEL = IPC_CHANNELS['event.guildEmojisUpdate'];
export const FORUM_POST_UPDATE_CHANNEL = IPC_CHANNELS['event.forumPostUpdate'];
export const FORUM_POST_DELETE_CHANNEL = IPC_CHANNELS['event.forumPostDelete'];
export const TYPING_START_CHANNEL = IPC_CHANNELS['event.typingStart'];
export const AUTONOMY_DRAFT_DELTA_CHANNEL = 'event.autonomyDraftDelta';
export const AUTONOMY_DRAFT_DONE_CHANNEL = 'event.autonomyDraftDone';
export const AUTONOMY_THINKING_START_CHANNEL = 'event.autonomyThinkingStart';
export const AUTONOMY_THINKING_END_CHANNEL = 'event.autonomyThinkingEnd';
