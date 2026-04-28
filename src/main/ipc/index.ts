import type { TokenVault } from '../vault/token-vault';
import type { Database as DB } from 'better-sqlite3';
import { registerBotHandlers } from './bot';
import { registerGuildHandlers } from './guilds';
import { registerMessageHandlers } from './messages';
import { registerSystemHandlers } from './system';
import { registerDraftsHandlers } from './drafts';
import { registerPrefsHandlers } from './prefs';
import type { ClientManager } from '../discord/client-manager';

export type IpcDeps = {
  vault: TokenVault;
  manager: ClientManager;
  db: DB;
};

export function registerAllIpc(deps: IpcDeps): void {
  registerBotHandlers(deps);
  registerGuildHandlers(deps);
  registerMessageHandlers(deps);
  registerSystemHandlers();
  registerDraftsHandlers(deps);
  registerPrefsHandlers(deps);
}
