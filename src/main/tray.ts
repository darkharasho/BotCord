import { app, Menu, Tray, nativeImage, Notification, BrowserWindow } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';

type TrayDeps = {
  getWindow: () => BrowserWindow | null;
  getAutonomyEnabled: () => boolean;
  setAutonomyEnabled: (enabled: boolean) => void;
  onQuit: () => void;
};

// Tray icon prefers the monochrome wordmark — system trays are typically
// dark on Linux/Windows and white-on-transparent reads cleanly. Falls back
// to the full colored icon if the white variant isn't bundled.
const ICON_CANDIDATES = [
  () => join(app.getAppPath(), 'public', 'botcord-white.png'),
  () => join(__dirname, '../../public/botcord-white.png'),
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
      // Scale by height only so non-square wordmarks (e.g. the white logo)
      // keep their aspect ratio. 22px is the canonical AppIndicator size on
      // Linux; macOS / Windows trays auto-scale from there.
      const { height } = img.getSize();
      if (height === 0) return img;
      return img.resize({ height: 22 });
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
