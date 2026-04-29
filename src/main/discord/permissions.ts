import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import type { BotCapabilities } from '../../shared/domain';

const REQUIRED_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
];

export const BOT_PERMISSIONS_BITFIELD = new PermissionsBitField(REQUIRED_PERMISSIONS).bitfield.toString();

const SNOWFLAKE_RE = /^\d{17,20}$/;

export function buildInviteUrl(clientId: string): string {
  if (!SNOWFLAKE_RE.test(clientId)) {
    throw new Error('Invalid Discord client ID (expected a 17-20 digit snowflake)');
  }
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('permissions', BOT_PERMISSIONS_BITFIELD);
  url.searchParams.set('scope', 'bot applications.commands');
  return url.toString();
}

// Narrow shape — accepts either a real GuildMember or a test fake.
export type CapabilitySubject = {
  id: string;
  permissionsBitfield: bigint;
  topRolePosition: number;
};

const MOD_PERM_NAMES: Array<[bigint, string]> = [
  [PermissionFlagsBits.ManageRoles,     'Manage Roles'],
  [PermissionFlagsBits.KickMembers,     'Kick Members'],
  [PermissionFlagsBits.BanMembers,      'Ban Members'],
  [PermissionFlagsBits.ModerateMembers, 'Timeout Members'],
];

export function missingPermissionNames(granted: bigint): string[] {
  const out: string[] = [];
  for (const [flag, name] of MOD_PERM_NAMES) {
    if ((granted & flag) === 0n) out.push(name);
  }
  return out;
}

export function computeBotCapabilities(
  bot: CapabilitySubject,
  target: CapabilitySubject,
): BotCapabilities {
  const has = (flag: bigint) => (bot.permissionsBitfield & flag) === flag;
  const outranks = bot.topRolePosition > target.topRolePosition;
  return {
    canManageRoles: has(PermissionFlagsBits.ManageRoles)     && outranks,
    canKick:        has(PermissionFlagsBits.KickMembers)     && outranks,
    canBan:         has(PermissionFlagsBits.BanMembers)      && outranks,
    canTimeout:     has(PermissionFlagsBits.ModerateMembers) && outranks,
    outranksTarget: outranks,
    botTopRolePosition: bot.topRolePosition,
    targetTopRolePosition: target.topRolePosition,
    missingPermissions: missingPermissionNames(bot.permissionsBitfield),
    targetIsSelf: bot.id === target.id,
  };
}
