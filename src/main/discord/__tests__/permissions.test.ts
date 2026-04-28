import { describe, it, expect } from 'vitest';
import { BOT_PERMISSIONS_BITFIELD, buildInviteUrl } from '../permissions';

describe('permissions', () => {
  it('exposes a non-zero bitfield string', () => {
    expect(typeof BOT_PERMISSIONS_BITFIELD).toBe('string');
    expect(BigInt(BOT_PERMISSIONS_BITFIELD)).toBeGreaterThan(0n);
  });

  it('builds a valid invite URL containing client_id, perms, and bot scope', () => {
    const url = buildInviteUrl('123456789012345678');
    expect(url).toMatch(/^https:\/\/discord\.com\/api\/oauth2\/authorize\?/);
    const params = new URL(url).searchParams;
    expect(params.get('client_id')).toBe('123456789012345678');
    expect(params.get('permissions')).toBe(BOT_PERMISSIONS_BITFIELD);
    expect(params.get('scope')).toBe('bot applications.commands');
  });

  it('rejects malformed client IDs', () => {
    expect(() => buildInviteUrl('')).toThrow();
    expect(() => buildInviteUrl('abc')).toThrow();
    expect(() => buildInviteUrl('12345')).toThrow();
    expect(() => buildInviteUrl('1234567890123456789012345')).toThrow();
  });
});
