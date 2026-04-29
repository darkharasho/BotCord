import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { GuildSummary, ChannelSummary, GuildEmoji, MemberSummary } from '../../shared/domain';
import { projectChannel, projectGuildEmojis } from '../discord/client-manager';
import type { IpcDeps } from './index';

export function registerGuildHandlers({ manager }: IpcDeps): void {
  ipcMain.handle(IPC_CHANNELS['guilds.list'], async (): Promise<Result<GuildSummary[]>> => {
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guilds = client.guilds.cache.map(g => ({
      id: g.id,
      name: g.name,
      iconUrl: g.icon?.startsWith('a_')
        ? g.iconURL({ size: 128, extension: 'gif' })
        : g.iconURL({ size: 128 }),
      memberCount: g.memberCount ?? null,
    }));
    return ok(guilds);
  });

  ipcMain.handle(IPC_CHANNELS['guilds.listChannels'], async (_, guildId: unknown): Promise<Result<ChannelSummary[]>> => {
    if (typeof guildId !== 'string') return err('INTERNAL', 'guildId must be a string');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);
    const channels = guild.channels.cache.map(c => projectChannel({
      id: c.id,
      guildId: guild.id,
      name: c.name,
      type: c.type,
      parentId: 'parentId' in c ? (c.parentId ?? null) : null,
      position: 'position' in c ? c.position : 0,
      topic: 'topic' in c ? (c.topic ?? null) : null,
    }));
    return ok(channels);
  });

  ipcMain.handle(IPC_CHANNELS['guilds.listEmojis'], async (_, guildId: unknown): Promise<Result<GuildEmoji[]>> => {
    if (typeof guildId !== 'string') return err('INTERNAL', 'guildId must be a string');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);
    return ok(projectGuildEmojis(guild.id, guild.emojis.cache.values()));
  });

  ipcMain.handle(IPC_CHANNELS['guilds.searchMembers'], async (_, guildId: unknown, query: unknown, limit: unknown): Promise<Result<MemberSummary[]>> => {
    if (typeof guildId !== 'string') return err('INTERNAL', 'guildId must be a string');
    if (typeof query !== 'string') return err('INTERNAL', 'query must be a string');
    const max = typeof limit === 'number' && limit > 0 && limit <= 25 ? Math.floor(limit) : 8;

    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);

    const trimmed = query.trim();

    // For empty queries return the most recently active members from cache.
    let candidates = Array.from(guild.members.cache.values());
    if (trimmed.length > 0) {
      // Try the gateway-backed search first (gives us members not in cache).
      try {
        const fetched = await guild.members.fetch({ query: trimmed, limit: max });
        candidates = Array.from(fetched.values());
      } catch {
        // Fall back to local cache filter.
        const q = trimmed.toLowerCase();
        candidates = candidates.filter(m =>
          m.user.username.toLowerCase().includes(q)
          || m.displayName.toLowerCase().includes(q)
          || (m.nickname?.toLowerCase().includes(q) ?? false));
      }
    }

    const summaries: MemberSummary[] = candidates.slice(0, max).map(m => ({
      id: m.id,
      displayName: m.displayName,
      username: m.user.username,
      avatarUrl: m.user.displayAvatarURL({ size: 64 }),
      roleColor: m.displayHexColor && m.displayHexColor !== '#000000' ? m.displayHexColor : null,
    }));

    return ok(summaries);
  });
}
