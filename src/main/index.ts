import { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor, type Tray } from 'electron';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { createMainWindow } from './window';
import { createAppTray, notifyMinimizedToTray, rebuildTrayMenu, setTrayUnreadBadge } from './tray';
import { IPC_CHANNELS } from '../shared/ipc-contract';
import { installCSP } from './security/csp';
import { createTokenVault } from './vault/token-vault';
import { createClientManager } from './discord/client-manager';
import { openDatabase } from './db/database';
import { registerAllIpc } from './ipc';
import { registerUpdater } from './updater';
import { createAutonomyModule } from './autonomy';
import { createPrefsRepo } from './db/repos/prefs';
import { createAutonomyRepo } from './db/repos/autonomy';
import { createDMChannelsRepo } from './db/repos/dm-channels';
import { attachDMSupport } from './discord/dm-support';
import { broadcast, AUTONOMY_DRAFT_DELTA_CHANNEL, AUTONOMY_DRAFT_DONE_CHANNEL } from './events/gateway-events';
import { CDKHost } from '@claude-cdk/core';
import type { AutonomyHost } from './autonomy/types';
import { attachAutonomousListener } from './autonomy/listener';

// PTT global hotkey is implemented with uiohook-napi (a passive OS-level
// keyboard listener) rather than Electron's globalShortcut. Reasons:
//   1. globalShortcut uses an X11 grab on Linux which interferes with the
//      input method on some setups — registering ANY hotkey breaks typing.
//   2. globalShortcut has no key-up event, so we'd have to fake hold
//      detection with a timer. uiohook gives real keydown + keyup.
// The hook runs in passive mode: it observes keystrokes but doesn't consume
// them, so the focused app still receives every key normally.

type PttBinding = {
  keycode: number;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
};

let pttBinding: PttBinding | null = null;
let uioStarted = false;
let uioStartFailed = false;
let uioEventCount = 0;
let uioLastEvent: { keycode: number; at: number } | null = null;

// We track each source independently and OR-combine. On X11, uiohook provides
// precise hold detection. On Wayland, uiohook can't see events — Electron's
// globalShortcut (via the XDG portal in Chromium 120+) becomes the working
// path with a 250ms rolling pulse since it has no key-up event.
let uiohookHeld = false;
let electronHeld = false;
let lastBroadcastHeld = false;
let currentElectronAccel: string | null = null;
let electronPulseTimer: NodeJS.Timeout | null = null;
let electronShortcutEvents = 0;

function broadcastPttHeld(held: boolean): void {
  // Direct broadcast (used by suspend handler etc.) — bypasses the dual-source
  // tracking; only used to force-release.
  lastBroadcastHeld = held;
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(IPC_CHANNELS['event.pttHeld'], held);
  }
}

function recomputeAndBroadcast(): void {
  const next = uiohookHeld || electronHeld;
  if (next === lastBroadcastHeld) return;
  lastBroadcastHeld = next;
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(IPC_CHANNELS['event.pttHeld'], next);
  }
}

function parseAccelerator(accel: string): PttBinding | null {
  const parts = accel.split('+').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const keyName = parts[parts.length - 1]!;
  const modifiers = parts.slice(0, -1);
  const table = UiohookKey as unknown as Record<string, number>;
  const keycode = table[keyName];
  if (typeof keycode !== 'number') return null;
  return {
    keycode,
    ctrl: modifiers.includes('Control') || modifiers.includes('CommandOrControl'),
    shift: modifiers.includes('Shift'),
    alt: modifiers.includes('Alt') || modifiers.includes('Option'),
    meta: modifiers.includes('Meta') || modifiers.includes('Command') || modifiers.includes('Super'),
  };
}

function matchesPttBinding(e: { keycode: number; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
  const b = pttBinding;
  if (!b) return false;
  return e.keycode === b.keycode
    && e.ctrlKey === b.ctrl
    && e.shiftKey === b.shift
    && e.altKey === b.alt
    && e.metaKey === b.meta;
}

function ensureUioStarted(): boolean {
  if (uioStarted) return true;
  if (uioStartFailed) return false;
  try {
    uIOhook.on('keydown', (e) => {
      uioEventCount++;
      uioLastEvent = { keycode: e.keycode, at: Date.now() };
      if (matchesPttBinding(e)) { uiohookHeld = true; recomputeAndBroadcast(); }
    });
    uIOhook.on('keyup', (e) => {
      if (matchesPttBinding(e)) { uiohookHeld = false; recomputeAndBroadcast(); }
    });
    uIOhook.start();
    uioStarted = true;
    return true;
  } catch (err) {
    // macOS without Accessibility permission, or missing native binary.
    uioStartFailed = true;
    console.warn('[voice] uiohook failed to start:', err);
    return false;
  }
}

// Try to set up the binding for global hold detection. Two parallel paths:
//   1. uiohook — passive listener, gives real keydown+keyup. Works on X11,
//      typically broken on Wayland (XkbGetKeyboard fails).
//   2. Electron's globalShortcut — uses Chromium's platform layer; on
//      Wayland this routes through the XDG portal (no input grab). Has no
//      key-up event so we fake hold with a 250ms rolling pulse.
// Either succeeding is enough for the binding to be considered "global".
function tryRegisterElectronShortcut(accelerator: string): boolean {
  try {
    return globalShortcut.register(accelerator, () => {
      electronShortcutEvents++;
      electronHeld = true;
      recomputeAndBroadcast();
      if (electronPulseTimer) clearTimeout(electronPulseTimer);
      electronPulseTimer = setTimeout(() => {
        electronHeld = false;
        recomputeAndBroadcast();
        electronPulseTimer = null;
      }, 250);
    });
  } catch {
    return false;
  }
}

function tryRegisterGlobalPtt(accelerator: string): boolean {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return false;
  // Set the binding regardless of which transport works — both consult it.
  pttBinding = parsed;
  const uioOk = ensureUioStarted();
  // Always ALSO try Electron's globalShortcut. On Wayland it's the only path
  // that works; on X11 it's redundant with uiohook but harmless.
  if (currentElectronAccel) {
    globalShortcut.unregister(currentElectronAccel);
    currentElectronAccel = null;
  }
  const electronOk = tryRegisterElectronShortcut(accelerator);
  if (electronOk) currentElectronAccel = accelerator;
  return uioOk || electronOk;
}

function clearGlobalPtt(): void {
  pttBinding = null;
  uiohookHeld = false;
  electronHeld = false;
  if (electronPulseTimer) { clearTimeout(electronPulseTimer); electronPulseTimer = null; }
  if (currentElectronAccel) {
    globalShortcut.unregister(currentElectronAccel);
    currentElectronAccel = null;
  }
  recomputeAndBroadcast();
}

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
    const prefs = createPrefsRepo(db);
    const autonomyDbRepo = createAutonomyRepo(db);
    const dmRepo = createDMChannelsRepo(db);

    const cdkScratch = join(userData, 'cdk-scratch');
    mkdirSync(cdkScratch, { recursive: true });

    const cdkHost = new CDKHost();
    const host: AutonomyHost = {
      detect: async () => {
        const r = await cdkHost.detect();
        return {
          found: r.found,
          ...(r.cliVersion !== undefined ? { version: r.cliVersion } : {}),
          ...(r.reason !== undefined ? { reason: r.reason } : {}),
        };
      },
      startSession: (opts) => cdkHost.startSession(opts),
    };

    const autonomy = createAutonomyModule({
      host,
      globalConfig: () => ({
        enabled: prefs.get('autonomyGlobalEnabled') ?? false,
        systemPrompt: prefs.get('autonomyGlobalSystemPrompt') ?? '',
        rateCapPerMin: prefs.get('autonomyGlobalRateCapPerMin') ?? 20,
        visionEnabled: prefs.get('autonomyVisionEnabled') ?? false,
        model: prefs.get('autonomyModel') ?? '',
        queueMaxDepth: prefs.get('autonomyQueueMaxDepth') ?? 5,
        queueTtlSeconds: prefs.get('autonomyQueueTtlSeconds') ?? 60,
      }),
      guildConfig: (guildId) => autonomyDbRepo.getGuildConfig(guildId),
      cwd: cdkScratch,
      events: {
        onDelta: (requestId, delta) => broadcast(AUTONOMY_DRAFT_DELTA_CHANNEL, { requestId, delta }),
        onDone: (requestId, text, stopReason) => broadcast(AUTONOMY_DRAFT_DONE_CHANNEL, { requestId, text, stopReason }),
      },
    });

    attachAutonomousListener({
      manager,
      autonomy,
      repo: autonomyDbRepo,
      scratchDir: cdkScratch,
      isVisionEnabled: () => prefs.get('autonomyVisionEnabled') ?? false,
      isGlobalEnabled: () => prefs.get('autonomyGlobalEnabled') ?? false,
    });

    registerAllIpc({ vault, manager, db, dmRepo, autonomy, host, scratchDir: cdkScratch });

    attachDMSupport(manager, dmRepo);

    let mainWindow: BrowserWindow | null = null;
    let tray: Tray | null = null;

    const trayDeps = {
      getWindow: () => mainWindow,
      getAutonomyEnabled: () => prefs.get('autonomyGlobalEnabled') ?? false,
      setAutonomyEnabled: (enabled: boolean) => {
        prefs.set('autonomyGlobalEnabled', enabled);
        if (tray) rebuildTrayMenu(tray, trayDeps);
      },
      onQuit: () => {
        (app as unknown as { isQuiting?: boolean }).isQuiting = true;
        app.quit();
      },
    };

    mainWindow = createMainWindow({
      shouldCloseToTray: () => prefs.get('closeToTray') ?? true,
      onMinimizedToTray: () => {
        if (!(prefs.get('closeToTrayHintShown') ?? false)) {
          notifyMinimizedToTray();
          prefs.set('closeToTrayHintShown', true);
        }
      },
    });
    registerUpdater(mainWindow);

    // Tray is unsupported on macOS in the same way (apps stay in dock); still
    // create one for parity but it's primarily for Windows/Linux users.
    if (process.platform !== 'darwin') {
      tray = createAppTray(trayDeps);
    }

    ipcMain.handle(IPC_CHANNELS['tray.setUnreadBadge'], async (_e, hasUnread: unknown) => {
      if (tray) setTrayUnreadBadge(tray, Boolean(hasUnread));
    });

    ipcMain.handle(IPC_CHANNELS['voice.getPttDiagnostics'], () => {
      const isWayland = process.platform === 'linux'
        && (process.env['XDG_SESSION_TYPE'] === 'wayland' || !!process.env['WAYLAND_DISPLAY']);
      return {
        uioStarted,
        uioStartFailed,
        isWayland,
        uioEventCount,
        uioLastEvent,
        electronShortcutRegistered: currentElectronAccel !== null,
        electronShortcutEvents,
      };
    });

    ipcMain.handle(IPC_CHANNELS['voice.setPttBinding'], (_e, accelerator: unknown, useGlobal: unknown) => {
      clearGlobalPtt();
      if (typeof accelerator !== 'string' || !accelerator) {
        return { scope: 'app' as const, downgraded: false };
      }
      // User opted out of global registration — keep the binding but don't
      // wire the passive hook. PTT only fires while BotCord is focused.
      if (useGlobal === false) {
        return { scope: 'app' as const, downgraded: false };
      }
      const ok = tryRegisterGlobalPtt(accelerator);
      if (ok) {
        return { scope: 'global' as const, downgraded: false };
      }
      return { scope: 'app' as const, downgraded: true };
    });

    // Re-register PTT accelerator from prefs on boot — only if the user has
    // opted into global registration. Update the persisted scope/downgrade
    // flags to reflect the actual result on this OS / this session.
    const stored = prefs.get('voiceInput');
    if (stored?.pttBinding?.accelerator) {
      // Treat missing pttGlobalEnabled (older prefs) as true to preserve
      // existing behavior for users who already configured PTT before this
      // flag existed.
      const wantsGlobal = stored.pttGlobalEnabled !== false;
      const ok = wantsGlobal && tryRegisterGlobalPtt(stored.pttBinding.accelerator);
      const next = {
        ...stored,
        pttScope: ok ? 'global' as const : 'app' as const,
        pttScopeDowngraded: wantsGlobal && !ok,
      };
      prefs.set('voiceInput', next);
    }

    app.on('before-quit', () => {
      (app as unknown as { isQuiting?: boolean }).isQuiting = true;
    });

    if (vault.hasToken()) {
      manager.connect().catch(() => { /* surfaced via gateway state events */ });
    }
  });

  app.on('will-quit', () => {
    if (uioStarted) { try { uIOhook.stop(); } catch { /* already stopped */ } }
    try { globalShortcut.unregisterAll(); } catch { /* nothing registered */ }
  });
  // browser-window-blur shouldn't force-release PTT anymore — the passive
  // hook keeps tracking the real keyboard state regardless of window focus.
  // We still release on suspend so a sleeping laptop doesn't leak a held
  // gate state.
  powerMonitor.on('suspend', () => broadcastPttHeld(false));

  app.on('window-all-closed', () => {
    // Don't quit when the only window was hidden to tray; the tray icon keeps
    // the app alive until the user explicitly chooses Quit.
    if (process.platform === 'darwin') return;
    if ((app as unknown as { isQuiting?: boolean }).isQuiting) app.quit();
  });
}
