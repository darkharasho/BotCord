import { app, BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
import { IPC_CHANNELS } from '../shared/ipc-contract';

function findIconPath(): string | undefined {
  const candidates = [
    join(app.getAppPath(), 'resources', 'icon-512.png'),
    join(__dirname, '../../resources/icon-512.png'),
    join(__dirname, '../resources/icon-512.png'),
  ];
  return candidates.find(p => existsSync(p));
}

export function createMainWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const opts: Electron.BrowserWindowConstructorOptions = {
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#1e1f22',
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
  const iconPath = findIconPath();
  if (iconPath) opts.icon = iconPath;
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
