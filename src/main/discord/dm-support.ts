import { Events, type Client } from 'discord.js';
import type { ClientManager } from './client-manager';
import type { DMChannelsRepo } from '../db/repos/dm-channels';
import { attachDMListener } from './dm-listener';

/**
 * Subscribes the DM listener to the live discord.js Client and runs backfill on
 * `ready` / `shardResume`. The Client instance is recreated on every
 * `manager.connect()` call (e.g. after re-saving a token), so we poll for a new
 * client and re-attach when it changes. Backfill also runs immediately if the
 * client is already ready at attach-time (which happens after the initial
 * connect resolves).
 */
export function attachDMSupport(manager: ClientManager, repo: DMChannelsRepo): () => void {
  let attachedClient: Client | null = null;

  const tryAttach = (): void => {
    const client = manager.getClient();
    if (!client) return;
    if (client === attachedClient) return;
    attachedClient = client;

    const dm = attachDMListener(client, repo);
    client.on(Events.ClientReady, () => { void dm.runBackfill(); });
    client.on(Events.ShardResume, () => { void dm.runBackfill(); });
    if (client.isReady()) {
      void dm.runBackfill();
    }
  };

  const interval = setInterval(tryAttach, 1000);
  tryAttach();

  return () => { clearInterval(interval); };
}
