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
  () => join(process.resourcesPath, 'resources', 'botcord-white.png'),
  () => join(app.getAppPath(), 'public', 'botcord-icon.png'),
  () => join(__dirname, '../../public/botcord-icon.png'),
  () => join(process.resourcesPath, 'resources', 'botcord-icon.png'),
  () => join(process.resourcesPath, 'resources', 'icon-256.png'),
  () => join(app.getAppPath(), 'resources', 'icon-256.png'),
  () => join(__dirname, '../../resources/icon-256.png'),
];

const ICON_HEIGHT = 22;

let baseIcon: Electron.NativeImage | null = null;
let baseIconBadged: Electron.NativeImage | null = null;

function loadBaseIcon(): Electron.NativeImage {
  if (baseIcon) return baseIcon;
  for (const get of ICON_CANDIDATES) {
    const p = get();
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      const { height } = img.getSize();
      baseIcon = height === 0 ? img : img.resize({ height: ICON_HEIGHT });
      return baseIcon;
    }
  }
  baseIcon = nativeImage.createEmpty();
  return baseIcon;
}

/**
 * Composites a small red dot onto the top-right of the base tray icon.
 * Uses Electron's bitmap pixel API (premultiplied BGRA) — no extra deps.
 * Result is cached for subsequent toggles.
 */
function loadBadgedIcon(): Electron.NativeImage {
  if (baseIconBadged) return baseIconBadged;
  const base = loadBaseIcon();
  const { width, height } = base.getSize();
  if (width === 0 || height === 0) { baseIconBadged = base; return base; }

  const buffer = base.toBitmap();
  const bytes = new Uint8ClampedArray(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const out = new Uint8ClampedArray(bytes); // copy

  // Sized as ~1/4 of icon height; pushed further into the top-right corner
  // by tightening the inset.
  const r = Math.max(3, Math.floor(height / 4));
  const cx = width - r;
  const cy = r;
  // Softer red — Discord-style coral rather than pure red.
  const RED_R = 237, RED_G = 66, RED_B = 69;
  const haloR = r + 1.5;
  for (let y = Math.max(0, cy - r - 2); y < Math.min(height, cy + r + 2); y++) {
    for (let x = Math.max(0, cx - r - 2); x < Math.min(width, cx + r + 2); x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const i = (y * width + x) * 4;
      if (d <= r) {
        // Inside disc, anti-aliased edge. Premultiplied BGRA.
        const aa = Math.min(1, r - d);
        const a = Math.round(255 * aa);
        out[i]     = Math.round(RED_B * aa); // B
        out[i + 1] = Math.round(RED_G * aa); // G
        out[i + 2] = Math.round(RED_R * aa); // R
        out[i + 3] = a;                       // A
      } else if (d <= haloR) {
        // Halo: punch a hole in whatever's underneath so the dot reads.
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 0;
      }
    }
  }

  const composited = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  baseIconBadged = nativeImage.createFromBitmap(composited, { width, height });
  return baseIconBadged;
}

export function createAppTray(deps: TrayDeps): Tray {
  const tray = new Tray(loadBaseIcon());
  tray.setToolTip('BotCord');
  applyMenu(tray, deps);

  // Left-click toggles window visibility on platforms where that's expected.
  tray.on('click', () => {
    const w = deps.getWindow();
    if (!w) return;
    if (w.isVisible() && !w.isMinimized()) w.hide();
    else { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
  });

  return tray;
}

function applyMenu(tray: Tray, deps: TrayDeps): void {
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
    { label: 'Quit BotCord', click: () => deps.onQuit() },
  ]);
  tray.setContextMenu(menu);
}

export function rebuildTrayMenu(tray: Tray, deps: TrayDeps): void {
  applyMenu(tray, deps);
}

export function setTrayUnreadBadge(tray: Tray, hasUnread: boolean): void {
  tray.setImage(hasUnread ? loadBadgedIcon() : loadBaseIcon());
}

export function notifyMinimizedToTray(): void {
  if (!Notification.isSupported()) return;
  new Notification({
    title: 'BotCord is in your system tray',
    body: 'Click the tray icon to bring it back. Right-click for options.',
    silent: true,
  }).show();
}
