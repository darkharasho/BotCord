import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { IPC_CHANNELS } from '../shared/ipc-contract';

// Adapted from sai/electron/services/updater.ts. Same lifecycle: silent
// background download, the renderer drives a small "update ready" pill via
// the `update:*` IPC events.

export function registerUpdater(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS['update.getVersion'], () => {
    return process.env.ELECTRON_RENDERER_URL ? 'DEV' : app.getVersion();
  });

  // electron-builder writes app-update.yml next to the packaged binary;
  // its presence is the canonical "this build can self-update" signal.
  const updateConfigPath = join(process.resourcesPath, 'app-update.yml');
  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE);
  const canAutoUpdate = app.isPackaged && !isPortable && existsSync(updateConfigPath);

  if (!canAutoUpdate) {
    // No-op handlers so the renderer's button presses don't hang.
    ipcMain.on(IPC_CHANNELS['update.check'], () => {});
    ipcMain.on(IPC_CHANNELS['update.install'], () => {});
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // On Linux, only the AppImage build supports auto-update — disable
  // auto-download for other Linux package formats so we don't repeatedly
  // hit the network for nothing.
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    autoUpdater.autoDownload = false;
  }

  const send = (channel: string, payload?: unknown) => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  };

  autoUpdater.on('checking-for-update', () => {
    send(IPC_CHANNELS['event.updateStatus'], 'checking');
  });
  autoUpdater.on('update-available', (info) => {
    send(IPC_CHANNELS['event.updateAvailable'], { version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    send(IPC_CHANNELS['event.updateStatus'], 'up-to-date');
  });
  autoUpdater.on('download-progress', (progress) => {
    send(IPC_CHANNELS['event.updateProgress'], {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    send(IPC_CHANNELS['event.updateDownloaded'], { version: info.version });
  });
  autoUpdater.on('error', (err) => {
    send(IPC_CHANNELS['event.updateError'], { message: err?.message ?? 'Unknown update error' });
  });

  ipcMain.on(IPC_CHANNELS['update.check'], () => {
    autoUpdater.checkForUpdates().catch(() => {});
  });
  ipcMain.on(IPC_CHANNELS['update.install'], () => {
    autoUpdater.quitAndInstall();
  });

  // Initial check after a short delay so we don't compete with first paint.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);
}
