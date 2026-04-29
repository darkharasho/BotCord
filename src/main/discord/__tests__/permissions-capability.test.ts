import { describe, it, expect } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { computeBotCapabilities, missingPermissionNames } from '../permissions';

// Minimal fakes shaped like what the real helpers consume — no discord.js
// objects required. Helpers are written to accept this narrower shape.
type FakeMember = {
  id: string;
  // Bitfield of granted permissions as a bigint
  permissionsBitfield: bigint;
  // Position of the highest role
  topRolePosition: number;
};

const ALL_PERMS =
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ModerateMembers;

const NO_PERMS = 0n;

describe('computeBotCapabilities', () => {
  it('returns all-true caps when bot has all perms and outranks target', () => {
    const bot: FakeMember    = { id: 'B', permissionsBitfield: ALL_PERMS, topRolePosition: 10 };
    const target: FakeMember = { id: 'T', permissionsBitfield: NO_PERMS, topRolePosition: 5 };
    const caps = computeBotCapabilities(bot, target);
    expect(caps.canManageRoles).toBe(true);
    expect(caps.canKick).toBe(true);
    expect(caps.canBan).toBe(true);
    expect(caps.canTimeout).toBe(true);
    expect(caps.outranksTarget).toBe(true);
    expect(caps.missingPermissions).toEqual([]);
    expect(caps.targetIsSelf).toBe(false);
  });

  it('disables all action caps when bot does not outrank target (equal positions)', () => {
    const bot: FakeMember    = { id: 'B', permissionsBitfield: ALL_PERMS, topRolePosition: 5 };
    const target: FakeMember = { id: 'T', permissionsBitfield: NO_PERMS, topRolePosition: 5 };
    const caps = computeBotCapabilities(bot, target);
    expect(caps.canManageRoles).toBe(false);
    expect(caps.canKick).toBe(false);
    expect(caps.canBan).toBe(false);
    expect(caps.canTimeout).toBe(false);
    expect(caps.outranksTarget).toBe(false);
    // Permissions are present — only hierarchy is the issue, so no missing perms
    expect(caps.missingPermissions).toEqual([]);
  });

  it('disables only the missing permission cap', () => {
    const bot: FakeMember = {
      id: 'B',
      permissionsBitfield: ALL_PERMS & ~PermissionFlagsBits.BanMembers,
      topRolePosition: 10,
    };
    const target: FakeMember = { id: 'T', permissionsBitfield: NO_PERMS, topRolePosition: 5 };
    const caps = computeBotCapabilities(bot, target);
    expect(caps.canManageRoles).toBe(true);
    expect(caps.canKick).toBe(true);
    expect(caps.canBan).toBe(false);
    expect(caps.canTimeout).toBe(true);
    expect(caps.missingPermissions).toEqual(['Ban Members']);
  });

  it('marks targetIsSelf when target id matches bot id', () => {
    const bot: FakeMember    = { id: 'X', permissionsBitfield: ALL_PERMS, topRolePosition: 10 };
    const caps = computeBotCapabilities(bot, { id: 'X', permissionsBitfield: NO_PERMS, topRolePosition: 1 });
    expect(caps.targetIsSelf).toBe(true);
  });
});

describe('missingPermissionNames', () => {
  it('lists human-readable names of missing flags from the moderation set', () => {
    const granted = PermissionFlagsBits.ManageRoles | PermissionFlagsBits.KickMembers;
    expect(missingPermissionNames(granted)).toEqual(['Ban Members', 'Timeout Members']);
  });

  it('returns empty when all four moderation perms are granted', () => {
    expect(missingPermissionNames(ALL_PERMS)).toEqual([]);
  });
});
