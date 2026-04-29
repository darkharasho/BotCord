import { ipcMain } from 'electron';
import { PermissionsBitField, type GuildMember } from 'discord.js';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { BulkActionResult } from '../../shared/domain';
import type { IpcDeps } from './index';

// Resolve the guild + bot member, validating that the bot has the given
// permission flag. Returns either a context object or a Result error.
async function resolveBotContext(
  manager: IpcDeps['manager'],
  guildId: string,
  requiredFlag: bigint,
  permName: string,
): Promise<{ guild: import('discord.js').Guild; botMember: GuildMember } | Result<never>> {
  const client = manager.getClient();
  if (!client || !client.isReady() || !client.user) return err('GATEWAY_OFFLINE', 'Bot is not connected');
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);
  const botMember = guild.members.cache.get(client.user.id) ?? await guild.members.fetch(client.user.id).catch(() => null);
  if (!botMember) return err('NOT_FOUND', 'Bot member not found in guild');
  if (!botMember.permissions.has(requiredFlag)) {
    return err('FORBIDDEN', `Bot is missing the ${permName} permission`);
  }
  return { guild, botMember };
}

async function fetchTarget(guild: import('discord.js').Guild, userId: string): Promise<GuildMember | null> {
  const cached = guild.members.cache.get(userId);
  if (cached) return cached;
  try { return await guild.members.fetch(userId); } catch { return null; }
}

export function registerMembersBulkHandlers({ manager }: IpcDeps): void {
  ipcMain.handle(IPC_CHANNELS['guilds.bulkAssignRole'], async (_, guildId: unknown, userIds: unknown, roleId: unknown): Promise<Result<BulkActionResult>> => {
    if (typeof guildId !== 'string' || !Array.isArray(userIds) || typeof roleId !== 'string') {
      return err('INTERNAL', 'guildId, userIds[], roleId required');
    }
    const ctx = await resolveBotContext(manager, guildId, PermissionsBitField.Flags.ManageRoles, 'Manage Roles');
    if (!('botMember' in ctx)) return ctx;
    const role = ctx.guild.roles.cache.get(roleId);
    if (!role) return err('NOT_FOUND', `Role ${roleId} not found`);
    if (role.managed) return err('FORBIDDEN', 'Cannot assign integration-managed roles');
    if (role.position >= ctx.botMember.roles.highest.position) {
      return err('FORBIDDEN', "Role is at or above the bot's highest role");
    }

    const result: BulkActionResult = { ok: [], failed: [] };
    for (const id of userIds) {
      if (typeof id !== 'string') { result.failed.push({ id: String(id), error: 'invalid id' }); continue; }
      const target = await fetchTarget(ctx.guild, id);
      if (!target) { result.failed.push({ id, error: 'member not found' }); continue; }
      if (target.roles.highest.position >= ctx.botMember.roles.highest.position) {
        result.failed.push({ id, error: "target's highest role is at or above the bot's" });
        continue;
      }
      try {
        await target.roles.add(role, 'Bulk-assigned via BotCord');
        result.ok.push(id);
      } catch (e) {
        result.failed.push({ id, error: e instanceof Error ? e.message : 'unknown error' });
      }
    }
    return ok(result);
  });

  ipcMain.handle(IPC_CHANNELS['guilds.bulkRemoveRole'], async (_, guildId: unknown, userIds: unknown, roleId: unknown): Promise<Result<BulkActionResult>> => {
    if (typeof guildId !== 'string' || !Array.isArray(userIds) || typeof roleId !== 'string') {
      return err('INTERNAL', 'guildId, userIds[], roleId required');
    }
    const ctx = await resolveBotContext(manager, guildId, PermissionsBitField.Flags.ManageRoles, 'Manage Roles');
    if (!('botMember' in ctx)) return ctx;
    const role = ctx.guild.roles.cache.get(roleId);
    if (!role) return err('NOT_FOUND', `Role ${roleId} not found`);
    if (role.managed) return err('FORBIDDEN', 'Cannot remove integration-managed roles');
    if (role.position >= ctx.botMember.roles.highest.position) {
      return err('FORBIDDEN', "Role is at or above the bot's highest role");
    }

    const result: BulkActionResult = { ok: [], failed: [] };
    for (const id of userIds) {
      if (typeof id !== 'string') { result.failed.push({ id: String(id), error: 'invalid id' }); continue; }
      const target = await fetchTarget(ctx.guild, id);
      if (!target) { result.failed.push({ id, error: 'member not found' }); continue; }
      if (target.roles.highest.position >= ctx.botMember.roles.highest.position) {
        result.failed.push({ id, error: "target's highest role is at or above the bot's" });
        continue;
      }
      try {
        await target.roles.remove(role, 'Bulk-removed via BotCord');
        result.ok.push(id);
      } catch (e) {
        result.failed.push({ id, error: e instanceof Error ? e.message : 'unknown error' });
      }
    }
    return ok(result);
  });
}
