import { safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync, chmodSync } from 'fs';
import { join } from 'path';

export interface TokenVault {
  hasToken(): boolean;
  saveToken(plaintext: string): Promise<void>;
  readToken(): Promise<string | null>;
  clear(): Promise<void>;
}

export function createTokenVault(baseDir: string): TokenVault {
  if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
  const file = join(baseDir, 'token.bin');
  const tmp = join(baseDir, 'token.bin.tmp');

  const ensureAvailable = () => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is unavailable on this system');
    }
  };

  return {
    hasToken: () => existsSync(file),

    async saveToken(plaintext: string) {
      ensureAvailable();
      const cipher = safeStorage.encryptString(plaintext);
      writeFileSync(tmp, cipher);
      try { chmodSync(tmp, 0o600); } catch { /* non-POSIX */ }
      renameSync(tmp, file);
    },

    async readToken() {
      if (!existsSync(file)) return null;
      ensureAvailable();
      const buf = readFileSync(file);
      return safeStorage.decryptString(buf);
    },

    async clear() {
      if (existsSync(file)) unlinkSync(file);
    },
  };
}
