import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { installCSP } from './security/csp';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    installCSP();
    createMainWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
