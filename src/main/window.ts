import { app, BrowserWindow, nativeImage, shell } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { IPC_CHANNELS } from '../shared/ipc-contract';

type WindowState = { width: number; height: number; x?: number; y?: number; maximized?: boolean };

const stateFile = () => join(app.getPath('userData'), 'window-state.json');

function loadWindowState(): WindowState | null {
  try {
    const raw = readFileSync(stateFile(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
      return parsed as WindowState;
    }
  } catch { /* missing / corrupt — fall back to defaults */ }
  return null;
}

function saveWindowState(state: WindowState): void {
  try { writeFileSync(stateFile(), JSON.stringify(state)); } catch { /* best effort */ }
}

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
  const saved = loadWindowState();
  const opts: Electron.BrowserWindowConstructorOptions = {
    width: saved?.width ?? 1280,
    height: saved?.height ?? 820,
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
      spellcheck: true,
    },
  };
  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
    opts.x = saved.x;
    opts.y = saved.y;
  }
  if (isMac) opts.trafficLightPosition = { x: 12, y: 9 };
  const icon = loadAppIcon();
  if (icon) opts.icon = icon;
  const win = new BrowserWindow(opts);
  if (saved?.maximized) win.maximize();

  // KDE/X11 needs an explicit setIcon after window creation for the taskbar
  // hint to pick up; the constructor `icon` only sets the initial frame icon.
  if (icon) win.setIcon(icon);

  win.once('ready-to-show', () => win.show());

  const broadcastMaximizeChange = () => {
    win.webContents.send(IPC_CHANNELS['event.windowMaximizeChange'], win.isMaximized());
  };
  win.on('maximize', broadcastMaximizeChange);
  win.on('unmaximize', broadcastMaximizeChange);

  // Persist window state. Debounce so dragging/resizing doesn't write per-pixel.
  let saveTimer: NodeJS.Timeout | null = null;
  const persist = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const maximized = win.isMaximized();
      // When maximized, store the *previous* normal bounds so unmaximize restores cleanly.
      const bounds = maximized ? win.getNormalBounds() : win.getBounds();
      saveWindowState({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized,
      });
    }, 250);
  };
  win.on('resize', persist);
  win.on('move', persist);
  win.on('maximize', persist);
  win.on('unmaximize', persist);
  win.on('close', () => { if (saveTimer) clearTimeout(saveTimer); persist(); });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://discord.com/') || url.startsWith('https://cdn.discordapp.com/')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) e.preventDefault();
  });

  // Forward Chromium's native context-menu params to the renderer so it can
  // render a themed menu (with spelling suggestions, edit flags, etc.). We
  // only forward editable-target right-clicks; non-editable surfaces (the
  // message list, channel rail, etc.) are handled by renderer-level
  // onContextMenu handlers.
  win.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    win.webContents.send(IPC_CHANNELS['event.systemContextMenu'], {
      x: params.x,
      y: params.y,
      selectionText: params.selectionText,
      misspelledWord: params.misspelledWord,
      dictionarySuggestions: params.dictionarySuggestions ?? [],
      editFlags: {
        canPaste: params.editFlags.canPaste,
        canCut: params.editFlags.canCut,
        canCopy: params.editFlags.canCopy,
        canSelectAll: params.editFlags.canSelectAll,
        canUndo: params.editFlags.canUndo,
        canRedo: params.editFlags.canRedo,
      },
    });
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}
