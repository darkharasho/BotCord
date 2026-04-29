import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';

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
