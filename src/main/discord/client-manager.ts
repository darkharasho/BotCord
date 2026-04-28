import { Client, Events } from 'discord.js';
import type { BotIdentity, BotStatus, GatewayState, GuildSummary, ChannelSummary, ChannelKind } from '../../shared/domain';
import { REQUIRED_INTENTS } from './intents';
import {
  broadcast,
  BOT_STATUS_CHANNEL,
  GATEWAY_EVENT_CHANNEL,
  GUILD_UPDATE_CHANNEL,
  CHANNEL_UPDATE_CHANNEL,
} from '../events/gateway-events';
import type { TokenVault } from '../vault/token-vault';

export type ClientManager = {
  getStatus(): BotStatus;
  getClient(): Client | null;
  connect(): Promise<{ ok: true; identity: BotIdentity } | { ok: false; reason: 'INVALID_TOKEN' | 'MISSING_INTENTS' | 'INTERNAL'; message: string }>;
  disconnect(): Promise<void>;
};

export function createClientManager(vault: TokenVault): ClientManager {
  let client: Client | null = null;
  let identity: BotIdentity | null = null;
  let gateway: GatewayState = { status: 'disconnected', reason: null };
  let reconnectAttempt = 0;

  const getStatus = (): BotStatus =>
    identity ? { kind: 'configured', identity, gateway } : { kind: 'unconfigured' };

  const setGateway = (next: GatewayState) => {
    gateway = next;
    broadcast(GATEWAY_EVENT_CHANNEL, gateway);
    broadcast(BOT_STATUS_CHANNEL, getStatus());
  };

  const toIdentity = (c: Client): BotIdentity => {
    const u = c.user!;
    return {
      id: u.id,
      username: u.username,
      discriminator: u.discriminator,
      avatarUrl: u.displayAvatarURL({ size: 128 }),
    };
  };

  const toGuildSummary = (g: { id: string; name: string; iconURL: (o?: { size: number }) => string | null; memberCount: number | null }): GuildSummary => ({
    id: g.id,
    name: g.name,
    iconUrl: g.iconURL({ size: 128 }) ?? null,
    memberCount: g.memberCount,
  });

  const wireEvents = (c: Client) => {
    c.on(Events.ClientReady, () => {
      identity = toIdentity(c);
      reconnectAttempt = 0;
      setGateway({ status: 'ready', sessionStartedAt: Date.now() });
    });
    c.on(Events.ShardDisconnect, (_, shardId) => {
      setGateway({ status: 'disconnected', reason: `shard ${shardId} disconnected` });
    });
    c.on(Events.ShardReconnecting, () => {
      reconnectAttempt += 1;
      setGateway({ status: 'reconnecting', attempt: reconnectAttempt, lastError: null });
    });
    c.on(Events.ShardError, (e) => {
      setGateway({ status: 'reconnecting', attempt: reconnectAttempt, lastError: e.message });
    });
    c.on(Events.GuildCreate, (g) => broadcast(GUILD_UPDATE_CHANNEL, toGuildSummary(g)));
    c.on(Events.GuildUpdate, (_, g) => broadcast(GUILD_UPDATE_CHANNEL, toGuildSummary(g)));
    c.on(Events.ChannelCreate, (ch) => broadcast(CHANNEL_UPDATE_CHANNEL, projectChannel(coerceChannel(ch))));
    c.on(Events.ChannelUpdate, (_, ch) => broadcast(CHANNEL_UPDATE_CHANNEL, projectChannel(coerceChannel(ch))));
  };

  return {
    getStatus,
    getClient: () => client,

    async connect() {
      const token = await vault.readToken();
      if (!token) return { ok: false, reason: 'INVALID_TOKEN', message: 'No token in vault' };

      client = new Client({ intents: REQUIRED_INTENTS });
      wireEvents(client);
      setGateway({ status: 'connecting' });

      try {
        await client.login(token);
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('gateway timeout')), 30_000);
          client!.once(Events.ClientReady, () => { clearTimeout(timeout); resolve(); });
          client!.once(Events.Error, (e) => { clearTimeout(timeout); reject(e); });
        });
        return { ok: true, identity: identity! };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        await this.disconnect();
        if (/disallowed intents/i.test(message)) {
          return { ok: false, reason: 'MISSING_INTENTS', message };
        }
        if (/token/i.test(message) && /invalid/i.test(message)) {
          return { ok: false, reason: 'INVALID_TOKEN', message };
        }
        return { ok: false, reason: 'INTERNAL', message };
      }
    },

    async disconnect() {
      if (client) {
        try { client.removeAllListeners(); client.destroy(); } catch { /* ignore */ }
      }
      client = null;
      identity = null;
      reconnectAttempt = 0;
      setGateway({ status: 'disconnected', reason: null });
    },
  };
}

export function projectChannel(ch: { id: string; guildId: string | null; name: string | null; type: number; parentId: string | null; position?: number; topic?: string | null }): ChannelSummary {
  return {
    id: ch.id,
    guildId: ch.guildId ?? '',
    name: ch.name ?? '(unnamed)',
    type: mapType(ch.type),
    parentId: ch.parentId ?? null,
    position: ch.position ?? 0,
    topic: ch.topic ?? null,
  };
}

function coerceChannel(ch: { id: string; type: number }): { id: string; guildId: string | null; name: string | null; type: number; parentId: string | null; position?: number; topic?: string | null } {
  const c = ch as { id: string; type: number; guildId?: string | null; name?: string | null; parentId?: string | null; position?: number; topic?: string | null };
  return {
    id: c.id,
    type: c.type,
    guildId: typeof c.guildId === 'string' ? c.guildId : null,
    name: typeof c.name === 'string' ? c.name : null,
    parentId: typeof c.parentId === 'string' ? c.parentId : null,
    position: typeof c.position === 'number' ? c.position : 0,
    topic: typeof c.topic === 'string' ? c.topic : null,
  };
}

function mapType(t: number): ChannelKind {
  switch (t) {
    case 0: return 'text';
    case 2: return 'voice';
    case 4: return 'category';
    case 5: return 'announcement';
    case 11:
    case 12: return 'thread';
    case 15: return 'forum';
    default: return 'other';
  }
}
