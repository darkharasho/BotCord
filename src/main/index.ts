import { app, BrowserWindow, ipcMain, type Tray } from 'electron';
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

    app.on('before-quit', () => {
      (app as unknown as { isQuiting?: boolean }).isQuiting = true;
    });

    if (vault.hasToken()) {
      manager.connect().catch(() => { /* surfaced via gateway state events */ });
    }
  });

  app.on('window-all-closed', () => {
    // Don't quit when the only window was hidden to tray; the tray icon keeps
    // the app alive until the user explicitly chooses Quit.
    if (process.platform === 'darwin') return;
    if ((app as unknown as { isQuiting?: boolean }).isQuiting) app.quit();
  });
}
