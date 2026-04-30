import { app, Menu, Tray, nativeImage, Notification, BrowserWindow } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';

type TrayDeps = {
  getWindow: () => BrowserWindow | null;
  getAutonomyEnabled: () => boolean;
  setAutonomyEnabled: (enabled: boolean) => void;
  onQuit: () => void;
};

const ICON_CANDIDATES = [
  () => join(app.getAppPath(), 'public', 'botcord-icon.png'),
  () => join(__dirname, '../../public/botcord-icon.png'),
  () => join(process.resourcesPath, 'resources', 'icon-256.png'),
  () => join(app.getAppPath(), 'resources', 'icon-256.png'),
  () => join(__dirname, '../../resources/icon-256.png'),
];

function loadTrayIcon(): Electron.NativeImage {
  for (const get of ICON_CANDIDATES) {
    const p = get();
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      // 22x22 is the canonical AppIndicator size on Linux; macOS auto-scales.
      return img.resize({ width: 22, height: 22 });
    }
  }
  return nativeImage.createEmpty();
}

export function createAppTray(deps: TrayDeps): Tray {
  const tray = new Tray(loadTrayIcon());
  tray.setToolTip('BotCord');

  const rebuild = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: 'Open BotCord',
        click: () => {
          const w = deps.getWindow();
          if (w) {
            if (w.isMinimized()) w.restore();
            w.show();
            w.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Autonomy',
        type: 'checkbox',
        checked: deps.getAutonomyEnabled(),
        click: (item) => deps.setAutonomyEnabled(item.checked),
      },
      { type: 'separator' },
      {
        label: 'Quit BotCord',
        click: () => deps.onQuit(),
      },
    ]);
    tray.setContextMenu(menu);
  };

  rebuild();

  // Left-click toggles window visibility on platforms where that's expected.
  tray.on('click', () => {
    const w = deps.getWindow();
    if (!w) return;
    if (w.isVisible() && !w.isMinimized()) w.hide();
    else { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
  });

  return tray;
}

export function notifyMinimizedToTray(): void {
  if (!Notification.isSupported()) return;
  new Notification({
    title: 'BotCord is in your system tray',
    body: 'Click the tray icon to bring it back. Right-click for options.',
    silent: true,
  }).show();
}

export function rebuildTrayMenu(tray: Tray, deps: TrayDeps): void {
  const menu = Menu.buildFromTemplate([
    { label: 'Open BotCord', click: () => { const w = deps.getWindow(); if (w) { w.show(); w.focus(); } } },
    { type: 'separator' },
    { label: 'Autonomy', type: 'checkbox', checked: deps.getAutonomyEnabled(), click: (item) => deps.setAutonomyEnabled(item.checked) },
    { type: 'separator' },
    { label: 'Quit BotCord', click: () => deps.onQuit() },
  ]);
  tray.setContextMenu(menu);
}
