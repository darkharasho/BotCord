import { ipcMain, app, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';

const ALLOWED_PREFIXES = [
  'https://discord.com/',
  'https://cdn.discordapp.com/',
  'https://discordapp.com/',
  'https://media.discordapp.net/',
];

export function registerSystemHandlers(): void {
  ipcMain.handle(IPC_CHANNELS['system.appVersion'], () => app.getVersion());
  ipcMain.handle(IPC_CHANNELS['system.openExternal'], async (_, url: unknown) => {
    if (typeof url !== 'string') return;
    if (!ALLOWED_PREFIXES.some(p => url.startsWith(p))) return;
    await shell.openExternal(url);
  });
}
