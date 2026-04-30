import type { TokenVault } from '../vault/token-vault';
import type { Database as DB } from 'better-sqlite3';
import { registerBotHandlers } from './bot';
import { registerGuildHandlers } from './guilds';
import { registerMessageHandlers } from './messages';
import { registerSystemHandlers } from './system';
import { registerDraftsHandlers } from './drafts';
import { registerPrefsHandlers } from './prefs';
import { registerMembersBulkHandlers } from './members-bulk';
import { registerVoiceHandlers } from './voice';
import { registerAutonomyHandlers } from './autonomy';
import type { ClientManager } from '../discord/client-manager';
import type { AutonomyModule } from '../autonomy';
import type { AutonomyHost } from '../autonomy/types';

export type IpcDeps = {
  vault: TokenVault;
  manager: ClientManager;
  db: DB;
};

export type IpcDepsWithAutonomy = IpcDeps & { autonomy: AutonomyModule; host: AutonomyHost };

export function registerAllIpc(deps: IpcDepsWithAutonomy): void {
  registerBotHandlers(deps);
  registerGuildHandlers(deps);
  registerMessageHandlers(deps);
  registerSystemHandlers();
  registerDraftsHandlers(deps);
  registerPrefsHandlers(deps);
  registerMembersBulkHandlers(deps);
  registerVoiceHandlers(deps);
  registerAutonomyHandlers(deps);
}
