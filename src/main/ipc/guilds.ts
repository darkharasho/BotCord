import { ipcMain } from 'electron';
import { PermissionsBitField, ChannelType, type GuildBasedChannel, type GuildMember } from 'discord.js';
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

  ipcMain.handle(IPC_CHANNELS['guilds.searchMembers'], async (_, guildId: unknown, query: unknown, opts: unknown): Promise<Result<MemberSummary[]>> => {
    if (typeof guildId !== 'string') return err('INTERNAL', 'guildId must be a string');
    if (typeof query !== 'string') return err('INTERNAL', 'query must be a string');
    const o = (opts && typeof opts === 'object' ? opts : {}) as { limit?: number; channelId?: string };
    const max = typeof o.limit === 'number' && o.limit > 0 && o.limit <= 25 ? Math.floor(o.limit) : 8;
    const channelId = typeof o.channelId === 'string' ? o.channelId : undefined;

    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);

    // Resolve the gating channel: for threads we check the parent text channel.
    let viewChannel: GuildBasedChannel | null = null;
    if (channelId) {
      const ch = guild.channels.cache.get(channelId) ?? null;
      if (ch && (ch.type === ChannelType.PublicThread || ch.type === ChannelType.PrivateThread || ch.type === ChannelType.AnnouncementThread)) {
        viewChannel = ch.parent ?? null;
      } else if (ch) {
        viewChannel = ch;
      }
    }

    const trimmed = query.trim();
    const fetchLimit = viewChannel ? Math.min(50, max * 4) : max;

    let candidates: GuildMember[] = Array.from(guild.members.cache.values());
    if (trimmed.length > 0) {
      try {
        const fetched = await guild.members.fetch({ query: trimmed, limit: fetchLimit });
        candidates = Array.from(fetched.values());
      } catch {
        const q = trimmed.toLowerCase();
        candidates = candidates.filter(m =>
          m.user.username.toLowerCase().includes(q)
          || m.displayName.toLowerCase().includes(q)
          || (m.nickname?.toLowerCase().includes(q) ?? false));
      }
    }

    if (viewChannel) {
      const view = PermissionsBitField.Flags.ViewChannel;
      candidates = candidates.filter(m => viewChannel!.permissionsFor(m)?.has(view) ?? false);
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
