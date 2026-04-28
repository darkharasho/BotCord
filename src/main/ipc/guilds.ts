import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { GuildSummary, ChannelSummary, GuildEmoji } from '../../shared/domain';
import { projectChannel, projectGuildEmojis } from '../discord/client-manager';
import type { IpcDeps } from './index';

export function registerGuildHandlers({ manager }: IpcDeps): void {
  ipcMain.handle(IPC_CHANNELS['guilds.list'], async (): Promise<Result<GuildSummary[]>> => {
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guilds = client.guilds.cache.map(g => ({
      id: g.id,
      name: g.name,
      iconUrl: g.iconURL({ size: 128 }) ?? null,
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
}
