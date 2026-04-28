import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createTokenVault } from '../token-vault';

let encryptionAvailable = true;
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (s: string) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
    decryptString: (b: Buffer) => Buffer.from(b.toString('utf8').replace(/^enc:/, ''), 'base64').toString('utf8'),
  },
}));

let dir: string;
beforeEach(() => {
  encryptionAvailable = true;
  dir = mkdtempSync(join(tmpdir(), 'botcord-vault-'));
});

afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe('TokenVault', () => {
  it('starts empty', () => {
    const v = createTokenVault(dir);
    expect(v.hasToken()).toBe(false);
  });

  it('saves, reads, and clears tokens round-trip', async () => {
    const v = createTokenVault(dir);
    await v.saveToken('my-secret-token');
    expect(v.hasToken()).toBe(true);
    expect(await v.readToken()).toBe('my-secret-token');
    await v.clear();
    expect(v.hasToken()).toBe(false);
    expect(await v.readToken()).toBe(null);
  });

  it('writes ciphertext to disk, never plaintext', async () => {
    const v = createTokenVault(dir);
    await v.saveToken('plaintext-marker');
    const path = join(dir, 'token.bin');
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path).toString('utf8');
    expect(raw.includes('plaintext-marker')).toBe(false);
    expect(raw.startsWith('enc:')).toBe(true);
  });

  it('throws when encryption is unavailable', async () => {
    encryptionAvailable = false;
    const v = createTokenVault(dir);
    await expect(v.saveToken('x')).rejects.toThrow(/encryption.*unavailable/i);
  });

  it('overwrites existing token atomically', async () => {
    const v = createTokenVault(dir);
    await v.saveToken('first');
    await v.saveToken('second');
    expect(await v.readToken()).toBe('second');
  });
});
