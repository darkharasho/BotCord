import { app, BrowserWindow } from 'electron';
import { join } from 'path';

// Sets WM_CLASS on Linux so KDE/GNOME taskbars match the .desktop entry's
// StartupWMClass and use its icon instead of the generic Electron one.
app.setName('BotCord');
import { createMainWindow } from './window';
import { installCSP } from './security/csp';
import { createTokenVault } from './vault/token-vault';
import { createClientManager } from './discord/client-manager';
import { openDatabase } from './db/database';
import { registerAllIpc } from './ipc';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    installCSP();

    const userData = app.getPath('userData');
    const vault = createTokenVault(join(userData, 'vault'));
    const manager = createClientManager(vault);
    const db = openDatabase(join(userData, 'botcord.sqlite'));

    registerAllIpc({ vault, manager, db });

    createMainWindow();

    if (vault.hasToken()) {
      manager.connect().catch(() => { /* surfaced via gateway state events */ });
    }
  });

  app.on('window-all-closed', () => app.quit());
}
