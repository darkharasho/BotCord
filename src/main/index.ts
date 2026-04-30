import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { createMainWindow } from './window';
import { installCSP } from './security/csp';
import { createTokenVault } from './vault/token-vault';
import { createClientManager } from './discord/client-manager';
import { openDatabase } from './db/database';
import { registerAllIpc } from './ipc';
import { registerUpdater } from './updater';
import { createAutonomyModule } from './autonomy';
import { createPrefsRepo } from './db/repos/prefs';
import { createAutonomyRepo } from './db/repos/autonomy';
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
    });

    registerAllIpc({ vault, manager, db, autonomy, host, scratchDir: cdkScratch });

    const win = createMainWindow();
    registerUpdater(win);

    if (vault.hasToken()) {
      manager.connect().catch(() => { /* surfaced via gateway state events */ });
    }
  });

  app.on('window-all-closed', () => app.quit());
}
