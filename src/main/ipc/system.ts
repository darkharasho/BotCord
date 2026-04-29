import { ipcMain, app, shell, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';

const ALLOWED_PREFIXES = [
  'https://discord.com/',
  'https://cdn.discordapp.com/',
  'https://discordapp.com/',
  'https://media.discordapp.net/',
];

const focusedWindow = (): BrowserWindow | null =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;

export function registerSystemHandlers(): void {
  ipcMain.handle(IPC_CHANNELS['system.appVersion'], () => app.getVersion());
  ipcMain.handle(IPC_CHANNELS['system.openExternal'], async (_, url: unknown) => {
    if (typeof url !== 'string') return;
    // Allow our well-known prefixes plus any https URL (embed/source links can come from anywhere).
    const allowed = ALLOWED_PREFIXES.some(p => url.startsWith(p)) || url.startsWith('https://');
    if (!allowed) return;
    await shell.openExternal(url);
  });

  ipcMain.handle(IPC_CHANNELS['window.minimize'], () => {
    focusedWindow()?.minimize();
  });
  ipcMain.handle(IPC_CHANNELS['window.toggleMaximize'], () => {
    const win = focusedWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  });
  ipcMain.handle(IPC_CHANNELS['window.close'], () => {
    focusedWindow()?.close();
  });
  ipcMain.handle(IPC_CHANNELS['window.isMaximized'], () => focusedWindow()?.isMaximized() ?? false);
  ipcMain.handle(IPC_CHANNELS['window.platform'], () => process.platform);
}
