import { ipcMain, app, shell, BrowserWindow, clipboard } from 'electron';
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

  // Edit actions for the focused webContents — invoked from the renderer's
  // themed context menu so it can drive the same Chromium APIs Discord's
  // native menu would use (Cut/Copy/Paste/Select All/Undo/Redo).
  ipcMain.handle(IPC_CHANNELS['system.editAction'], (_e, action: unknown) => {
    const wc = focusedWindow()?.webContents;
    if (!wc) return;
    switch (action) {
      case 'cut': wc.cut(); break;
      case 'copy': wc.copy(); break;
      case 'paste': wc.paste(); break;
      case 'selectAll': wc.selectAll(); break;
      case 'undo': wc.undo(); break;
      case 'redo': wc.redo(); break;
    }
  });

  ipcMain.handle(IPC_CHANNELS['system.replaceMisspelling'], (_e, word: unknown) => {
    if (typeof word !== 'string') return;
    focusedWindow()?.webContents.replaceMisspelling(word);
  });

  ipcMain.handle(IPC_CHANNELS['system.addToDictionary'], (_e, word: unknown) => {
    if (typeof word !== 'string' || !word.trim()) return;
    focusedWindow()?.webContents.session.addWordToSpellCheckerDictionary(word);
  });

  // Native clipboard write — more reliable than `navigator.clipboard` in
  // sandboxed renderers, especially when the calling element has just
  // unmounted (e.g. after a context menu closes).
  ipcMain.handle(IPC_CHANNELS['system.copyText'], (_e, text: unknown) => {
    if (typeof text !== 'string') return;
    clipboard.writeText(text);
  });
}
