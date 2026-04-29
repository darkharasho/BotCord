import { ipcMain } from 'electron';
import { PermissionsBitField, ChannelType, type GuildBasedChannel, type GuildMember, type ForumChannel, type MediaChannel } from 'discord.js';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { GuildSummary, ChannelSummary, GuildEmoji, MemberSummary, MemberDetail, MemberRole, ChannelMemberSummary, PresenceStatus, RoleIcon, ForumChannelDetail, ForumPostSummary, GuildRole, BotCapabilities } from '../../shared/domain';
import { projectChannel, projectGuildEmojis, voiceMembersFor, projectForumChannel, fetchArchivedForumPosts } from '../discord/client-manager';
import { computeBotCapabilities } from '../discord/permissions';
import type { IpcDeps } from './index';

function scoreMatch(m: GuildMember, q: string): number {
  const display = m.displayName.toLowerCase();
  const username = m.user.username.toLowerCase();
  const nick = m.nickname?.toLowerCase() ?? '';
  if (display.startsWith(q) || nick.startsWith(q)) return 3;
  if (username.startsWith(q)) return 2;
  if (display.includes(q) || username.includes(q) || nick.includes(q)) return 1;
  return 0;
}

export function registerGuildHandlers({ manager }: IpcDeps): void {
  // Returns null if everything is fine, or a Result error if not.
  async function assertCanManageRoleOnTarget(guildId: string, targetUserId: string, roleId: string): Promise<{ guild: import('discord.js').Guild; target: GuildMember; role: import('discord.js').Role } | Result<never>> {
    const client = manager.getClient();
    if (!client || !client.isReady() || !client.user) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);
    const botMember = guild.members.cache.get(client.user.id) ?? await guild.members.fetch(client.user.id).catch(() => null);
    if (!botMember) return err('NOT_FOUND', 'Bot member not found in guild');
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return err('FORBIDDEN', 'Bot is missing the Manage Roles permission');
    }
    const role = guild.roles.cache.get(roleId);
    if (!role) return err('NOT_FOUND', `Role ${roleId} not found`);
    if (role.managed) return err('FORBIDDEN', 'Cannot assign integration-managed roles');
    if (role.position >= botMember.roles.highest.position) {
      return err('FORBIDDEN', "Role is at or above the bot's highest role");
    }
    let target: GuildMember | undefined = guild.members.cache.get(targetUserId);
    if (!target) { try { target = await guild.members.fetch(targetUserId); } catch { /* fall */ } }
    if (!target) return err('NOT_FOUND', `Member ${targetUserId} not found`);
    if (target.roles.highest.position >= botMember.roles.highest.position) {
      return err('FORBIDDEN', "Target's highest role is at or above the bot's highest role");
    }
    return { guild, target, role };
  }

  ipcMain.handle(IPC_CHANNELS['guilds.assignRole'], async (_, guildId: unknown, userId: unknown, roleId: unknown): Promise<Result<void>> => {
    if (typeof guildId !== 'string' || typeof userId !== 'string' || typeof roleId !== 'string') return err('INTERNAL', 'guildId, userId, roleId required');
    const guard = await assertCanManageRoleOnTarget(guildId, userId, roleId);
    if (!('target' in guard)) return guard;
    try {
      await guard.target.roles.add(guard.role, 'Assigned via BotCord');
      return ok(undefined);
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : 'Failed to assign role');
    }
  });

  ipcMain.handle(IPC_CHANNELS['guilds.removeRole'], async (_, guildId: unknown, userId: unknown, roleId: unknown): Promise<Result<void>> => {
    if (typeof guildId !== 'string' || typeof userId !== 'string' || typeof roleId !== 'string') return err('INTERNAL', 'guildId, userId, roleId required');
    const guard = await assertCanManageRoleOnTarget(guildId, userId, roleId);
    if (!('target' in guard)) return guard;
    try {
      await guard.target.roles.remove(guard.role, 'Removed via BotCord');
      return ok(undefined);
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : 'Failed to remove role');
    }
  });

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
    }, voiceMembersFor(c)));
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

    const trimmed = query.trim().toLowerCase();

    // Make sure the full member roster is in cache so client-side filtering
    // returns consistent results on every keystroke. discord.js caches the
    // result on guild.members.cache so subsequent calls are free.
    if (typeof guild.memberCount === 'number' && guild.members.cache.size < guild.memberCount) {
      try { await guild.members.fetch(); } catch { /* missing privileged intent — fall through */ }
    }

    let candidates: GuildMember[] = Array.from(guild.members.cache.values());

    if (trimmed.length > 0) {
      // Rank: prefix match on display/nick > prefix on username > substring anywhere.
      const scored = candidates
        .map(m => ({ m, score: scoreMatch(m, trimmed) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score || a.m.displayName.localeCompare(b.m.displayName));
      candidates = scored.map(x => x.m);
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

  ipcMain.handle(IPC_CHANNELS['guilds.listChannelMembers'], async (_, guildId: unknown, channelId: unknown): Promise<Result<ChannelMemberSummary[]>> => {
    if (typeof guildId !== 'string' || typeof channelId !== 'string') return err('INTERNAL', 'guildId and channelId required');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);

    let viewChannel: GuildBasedChannel | null = guild.channels.cache.get(channelId) ?? null;
    if (viewChannel && (viewChannel.type === ChannelType.PublicThread || viewChannel.type === ChannelType.PrivateThread || viewChannel.type === ChannelType.AnnouncementThread)) {
      viewChannel = viewChannel.parent ?? null;
    }
    if (!viewChannel) return err('NOT_FOUND', `Channel ${channelId} not found`);

    // Make sure all members are loaded so the list isn't sparse.
    try { await guild.members.fetch(); } catch { /* missing privileged intent — fall back to cache */ }

    const view = PermissionsBitField.Flags.ViewChannel;
    const visible = guild.members.cache.filter(m => viewChannel!.permissionsFor(m)?.has(view) ?? false);

    const out: ChannelMemberSummary[] = [];
    for (const m of visible.values()) {
      const status = (m.presence?.status ?? 'offline') as PresenceStatus;
      const hoist = m.roles.hoist;
      const roleIcons: RoleIcon[] = [];
      for (const role of m.roles.cache.sort((a, b) => b.position - a.position).values()) {
        const iconUrl = role.iconURL({ size: 32 });
        const unicodeEmoji = role.unicodeEmoji ?? null;
        if (iconUrl || unicodeEmoji) {
          roleIcons.push({ roleId: role.id, roleName: role.name, iconUrl, unicodeEmoji });
        }
      }
      out.push({
        id: m.id,
        displayName: m.displayName,
        username: m.user.username,
        avatarUrl: m.user.displayAvatarURL({ size: 64 }),
        roleColor: m.displayHexColor && m.displayHexColor !== '#000000' ? m.displayHexColor : null,
        status,
        topRole: hoist
          ? {
              id: hoist.id,
              name: hoist.name,
              color: hoist.color ? `#${hoist.color.toString(16).padStart(6, '0')}` : null,
              position: hoist.position,
              iconUrl: hoist.iconURL({ size: 32 }),
              unicodeEmoji: hoist.unicodeEmoji ?? null,
            }
          : null,
        roleIcons,
      });
    }
    return ok(out);
  });

  ipcMain.handle(IPC_CHANNELS['guilds.getMember'], async (_, guildId: unknown, userId: unknown): Promise<Result<MemberDetail>> => {
    if (typeof guildId !== 'string' || typeof userId !== 'string') return err('INTERNAL', 'guildId and userId required');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);

    let member: GuildMember | undefined = guild.members.cache.get(userId);
    if (!member) {
      try { member = await guild.members.fetch(userId); } catch { /* not found */ }
    }
    if (!member) return err('NOT_FOUND', `Member ${userId} not found`);

    const status = (member.presence?.status ?? 'offline') as PresenceStatus;
    const hoist = member.roles.hoist;
    const roles: MemberRole[] = member.roles.cache
      .filter(r => r.id !== guild.id) // exclude @everyone
      .sort((a, b) => b.position - a.position)
      .map(r => ({
        id: r.id,
        name: r.name,
        color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
        position: r.position,
        iconUrl: r.iconURL({ size: 32 }),
        unicodeEmoji: r.unicodeEmoji ?? null,
      }));

    return ok({
      id: member.id,
      displayName: member.displayName,
      username: member.user.username,
      avatarUrl: member.user.displayAvatarURL({ size: 128 }),
      bannerColor: member.user.hexAccentColor ?? null,
      roleColor: member.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null,
      status,
      isBot: member.user.bot,
      joinedAt: member.joinedTimestamp ?? null,
      createdAt: member.user.createdTimestamp,
      roles,
      topRole: hoist
        ? {
            id: hoist.id,
            name: hoist.name,
            color: hoist.color ? `#${hoist.color.toString(16).padStart(6, '0')}` : null,
            position: hoist.position,
            iconUrl: hoist.iconURL({ size: 32 }),
            unicodeEmoji: hoist.unicodeEmoji ?? null,
          }
        : null,
    });
  });

  ipcMain.handle(IPC_CHANNELS['guilds.getForum'], async (_, guildId: unknown, forumId: unknown): Promise<Result<ForumChannelDetail>> => {
    if (typeof guildId !== 'string' || typeof forumId !== 'string') return err('INTERNAL', 'guildId and forumId required');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);
    const ch = guild.channels.cache.get(forumId);
    if (!ch || (ch.type !== ChannelType.GuildForum && ch.type !== ChannelType.GuildMedia)) {
      return err('NOT_FOUND', `Forum ${forumId} not found`);
    }
    // Always fetch active threads. The cache is populated lazily by gateway
    // events (mainly pinned posts on guild ready), so checking for empty
    // misses the case where pinned threads are cached but regular active
    // posts aren't. fetchActive() is paginated server-side and cheap.
    const forum = ch as ForumChannel | MediaChannel;
    try { await forum.threads.fetchActive(); } catch { /* fall back to whatever's cached */ }
    return ok(projectForumChannel(forum));
  });

  ipcMain.handle(IPC_CHANNELS['guilds.listArchivedForumPosts'], async (_, guildId: unknown, forumId: unknown): Promise<Result<ForumPostSummary[]>> => {
    if (typeof guildId !== 'string' || typeof forumId !== 'string') return err('INTERNAL', 'guildId and forumId required');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);
    return ok(await fetchArchivedForumPosts(guild, forumId));
  });

  ipcMain.handle(IPC_CHANNELS['guilds.listGuildRoles'], async (_, guildId: unknown): Promise<Result<GuildRole[]>> => {
    if (typeof guildId !== 'string') return err('INTERNAL', 'guildId must be a string');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);

    const roles: GuildRole[] = Array.from(guild.roles.cache.values())
      .filter(r => r.id !== guild.id) // exclude @everyone
      .sort((a, b) => b.position - a.position)
      .map(r => ({
        id: r.id,
        name: r.name,
        color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
        position: r.position,
        managed: r.managed,
        iconUrl: r.iconURL({ size: 32 }),
        unicodeEmoji: r.unicodeEmoji ?? null,
      }));
    return ok(roles);
  });

  ipcMain.handle(IPC_CHANNELS['guilds.getBotCapabilities'], async (_, guildId: unknown, targetUserId: unknown): Promise<Result<BotCapabilities>> => {
    if (typeof guildId !== 'string' || typeof targetUserId !== 'string') return err('INTERNAL', 'guildId and targetUserId required');
    const client = manager.getClient();
    if (!client || !client.isReady() || !client.user) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);

    const botMember = guild.members.cache.get(client.user.id) ?? await guild.members.fetch(client.user.id).catch(() => null);
    if (!botMember) return err('NOT_FOUND', 'Bot member not found in guild');

    let target: GuildMember | undefined = guild.members.cache.get(targetUserId);
    if (!target) { try { target = await guild.members.fetch(targetUserId); } catch { /* fall through */ } }
    if (!target) return err('NOT_FOUND', `Member ${targetUserId} not found`);

    const caps = computeBotCapabilities(
      { id: botMember.id, permissionsBitfield: botMember.permissions.bitfield, topRolePosition: botMember.roles.highest.position },
      { id: target.id,    permissionsBitfield: target.permissions.bitfield,    topRolePosition: target.roles.highest.position },
    );
    return ok(caps);
  });
}
