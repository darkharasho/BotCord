import { app, BrowserWindow, nativeImage, shell } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
import { IPC_CHANNELS } from '../shared/ipc-contract';

function loadAppIcon(): Electron.NativeImage | undefined {
  // Use the raw source PNG. Linux WMs (KDE/Plasma especially) handle the
  // scaling themselves and behave better with the original aspect than with
  // our pre-padded square — the padded version was being clipped further
  // by the WM's own framing. AxiPulse uses this exact pattern.
  const candidates = [
    join(app.getAppPath(), 'public', 'botcord-icon.png'),
    join(__dirname, '../../public/botcord-icon.png'),
    join(__dirname, '../renderer/botcord-icon.png'),
  ];
  const path = candidates.find(p => existsSync(p));
  return path ? nativeImage.createFromPath(path) : undefined;
}

export function createMainWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const opts: Electron.BrowserWindowConstructorOptions = {
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#121214',
    show: false,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  };
  if (isMac) opts.trafficLightPosition = { x: 12, y: 9 };
  const icon = loadAppIcon();
  if (icon) opts.icon = icon;
  const win = new BrowserWindow(opts);

  // KDE/X11 needs an explicit setIcon after window creation for the taskbar
  // hint to pick up; the constructor `icon` only sets the initial frame icon.
  if (icon) win.setIcon(icon);

  win.once('ready-to-show', () => win.show());

  const broadcastMaximizeChange = () => {
    win.webContents.send(IPC_CHANNELS['event.windowMaximizeChange'], win.isMaximized());
  };
  win.on('maximize', broadcastMaximizeChange);
  win.on('unmaximize', broadcastMaximizeChange);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://discord.com/') || url.startsWith('https://cdn.discordapp.com/')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) e.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}
