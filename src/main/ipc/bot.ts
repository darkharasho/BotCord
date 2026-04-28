import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { BotIdentity, BotStatus } from '../../shared/domain';
import type { TokenVault } from '../vault/token-vault';
import { buildInviteUrl } from '../discord/permissions';

type Deps = {
  vault: TokenVault;
  manager: {
    getStatus(): BotStatus;
    connect(): Promise<{ ok: true; identity: BotIdentity } | { ok: false; reason: string; message: string }>;
    disconnect(): Promise<void>;
  };
};

export function registerBotHandlers({ vault, manager }: Deps): void {
  ipcMain.handle(IPC_CHANNELS['bot.getStatus'], (): BotStatus => manager.getStatus());

  ipcMain.handle(IPC_CHANNELS['bot.validateToken'], async (_, token: unknown): Promise<Result<BotIdentity>> => {
    if (typeof token !== 'string' || !token.trim()) return err('INVALID_TOKEN', 'Token must be a non-empty string');
    try {
      const res = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${token.trim()}` },
      });
      if (res.status === 401) return err('INVALID_TOKEN', 'Discord rejected the token');
      if (!res.ok) return err('DISCORD_HTTP_ERROR', `HTTP ${res.status}`);
      const data = await res.json() as { id: string; username: string; discriminator: string; avatar: string | null };
      return ok({
        id: data.id,
        username: data.username,
        discriminator: data.discriminator,
        avatarUrl: data.avatar
          ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=128`
          : null,
      });
    } catch (e) {
      return err('INTERNAL', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['bot.saveToken'], async (_, token: unknown): Promise<Result<BotIdentity>> => {
    if (typeof token !== 'string' || !token.trim()) return err('INVALID_TOKEN', 'Token must be a non-empty string');
    const validateRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token.trim()}` },
    });
    if (validateRes.status === 401) return err('INVALID_TOKEN', 'Discord rejected the token');
    if (!validateRes.ok) return err('DISCORD_HTTP_ERROR', `HTTP ${validateRes.status}`);

    await vault.saveToken(token.trim());
    const result = await manager.connect();
    if (!result.ok) {
      if (result.reason === 'MISSING_INTENTS') return err('MISSING_INTENTS', result.message);
      if (result.reason === 'INVALID_TOKEN') return err('INVALID_TOKEN', result.message);
      return err('INTERNAL', result.message);
    }
    return ok(result.identity);
  });

  ipcMain.handle(IPC_CHANNELS['bot.clearToken'], async (): Promise<Result<void>> => {
    await manager.disconnect();
    await vault.clear();
    return ok(undefined);
  });

  ipcMain.handle(IPC_CHANNELS['bot.buildInviteUrl'], async (_, clientId: unknown): Promise<Result<string>> => {
    if (typeof clientId !== 'string') return err('INTERNAL', 'clientId must be a string');
    try {
      return ok(buildInviteUrl(clientId));
    } catch (e) {
      return err('INTERNAL', e instanceof Error ? e.message : String(e));
    }
  });
}
