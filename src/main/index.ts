import { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor, type Tray } from 'electron';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { createMainWindow } from './window';
import { createAppTray, notifyMinimizedToTray, rebuildTrayMenu, setTrayUnreadBadge } from './tray';
import { IPC_CHANNELS } from '../shared/ipc-contract';
import { isSafeGlobalAccelerator } from '../shared/voice-input';
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

let currentPttAccelerator: string | null = null;
let pttPulseTimer: NodeJS.Timeout | null = null;

function broadcastPttHeld(held: boolean): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(IPC_CHANNELS['event.pttHeld'], held);
  }
}

// Electron's globalShortcut only fires on key-press (no up). We translate
// repeated press fires (auto-repeat while held) into a single open window
// by pushing `true` and resetting a 250 ms timer; when the timer expires
// without another fire, we emit `false`. A tap still produces >= one frame.
function tryRegisterGlobalPtt(accelerator: string): boolean {
  // Refuse bare letter / digit / Space / Enter / etc. globally — registering
  // them would consume every press of that key in every app on the system.
  // The renderer can still bind them in app-only scope.
  if (!isSafeGlobalAccelerator(accelerator)) return false;
  try {
    return globalShortcut.register(accelerator, () => {
      broadcastPttHeld(true);
      if (pttPulseTimer) clearTimeout(pttPulseTimer);
      pttPulseTimer = setTimeout(() => {
        broadcastPttHeld(false);
        pttPulseTimer = null;
      }, 250);
    });
  } catch {
    return false;
  }
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

    ipcMain.handle(IPC_CHANNELS['voice.setPttBinding'], (_e, accelerator: unknown, useGlobal: unknown) => {
      if (currentPttAccelerator) {
        globalShortcut.unregister(currentPttAccelerator);
        currentPttAccelerator = null;
      }
      if (typeof accelerator !== 'string' || !accelerator) {
        return { scope: 'app' as const, downgraded: false };
      }
      // User opted out of global registration — keep the binding but don't
      // register with the OS. Avoids global-hotkey-induced typing issues.
      if (useGlobal === false) {
        return { scope: 'app' as const, downgraded: false };
      }
      const ok = tryRegisterGlobalPtt(accelerator);
      if (ok) {
        currentPttAccelerator = accelerator;
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
      if (ok) currentPttAccelerator = stored.pttBinding.accelerator;
    }

    app.on('before-quit', () => {
      (app as unknown as { isQuiting?: boolean }).isQuiting = true;
    });

    if (vault.hasToken()) {
      manager.connect().catch(() => { /* surfaced via gateway state events */ });
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (pttPulseTimer) { clearTimeout(pttPulseTimer); pttPulseTimer = null; }
  });
  app.on('browser-window-blur', () => broadcastPttHeld(false));
  powerMonitor.on('suspend', () => broadcastPttHeld(false));

  app.on('window-all-closed', () => {
    // Don't quit when the only window was hidden to tray; the tray icon keeps
    // the app alive until the user explicitly chooses Quit.
    if (process.platform === 'darwin') return;
    if ((app as unknown as { isQuiting?: boolean }).isQuiting) app.quit();
  });
}
