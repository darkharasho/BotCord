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
