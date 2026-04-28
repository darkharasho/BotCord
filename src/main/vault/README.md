# Token Vault

Stores the bot token encrypted at rest using Electron's `safeStorage` API.

## Threat model

- **At rest:** ciphertext only on disk. `safeStorage` delegates to OS keychain (Keychain / DPAPI / libsecret).
- **In memory:** plaintext exists only inside the discord.js client and during the brief `readToken()` → `Client.login()` call. Never logged.
- **Cross-process:** plaintext never crosses the contextBridge. The renderer cannot read the token.
- **File mode:** `0600` on POSIX. No effect on Windows; OS-level ACLs apply.

## Failure modes

- `safeStorage.isEncryptionAvailable()` false → throws. We refuse to silently store plaintext or weakly-encrypted data.
- `token.bin.tmp` left behind from a crashed save → next save overwrites it via atomic rename.

## Audit checklist

- Vault is the only module that imports `safeStorage`.
- Vault is consumed only by `discord/client-manager.ts`.
- No `console.log` or telemetry references the plaintext.
