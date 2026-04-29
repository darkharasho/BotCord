import { app, BrowserWindow, nativeImage, shell } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
import { IPC_CHANNELS } from '../shared/ipc-contract';

function loadAppIcon(): Electron.NativeImage | undefined {
  const roots = [
    join(app.getAppPath(), 'resources'),
    join(__dirname, '../../resources'),
    join(__dirname, '../resources'),
  ];
  const root = roots.find(r => existsSync(join(r, 'icon-512.png')));
  if (!root) return undefined;
  // Combine multiple resolutions so the WM picks the best size for the slot
  // it's rendering into (taskbar 24-48px, alt-tab ~128px, icon-only docks 256+).
  const big = nativeImage.createFromPath(join(root, 'icon-512.png'));
  if (existsSync(join(root, 'icon-256.png'))) {
    const small = nativeImage.createFromPath(join(root, 'icon-256.png'));
    big.addRepresentation({ scaleFactor: 0.5, buffer: small.toPNG() });
  }
  return big;
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
