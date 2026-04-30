import { ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { GuildAutonomyConfig, GlobalAutonomyConfig } from '../../shared/domain';
import { DEFAULT_GLOBAL_SYSTEM_PROMPT } from '../../shared/domain';
import type { IpcDeps } from './index';
import { createAutonomyRepo } from '../db/repos/autonomy';
import { createPrefsRepo } from '../db/repos/prefs';
import type { AutonomyModule } from '../autonomy';
import type { AutonomyHost } from '../autonomy/types';
import { renderMessageContent } from '../autonomy/message-render';

type Deps = IpcDeps & { autonomy: AutonomyModule; host: AutonomyHost; scratchDir: string };

export function registerAutonomyHandlers({ db, manager, autonomy, host, scratchDir }: Deps): void {
  const repo = createAutonomyRepo(db);
  const prefs = createPrefsRepo(db);

  const readGlobal = (): GlobalAutonomyConfig => ({
    enabled: prefs.get('autonomyGlobalEnabled') ?? false,
    systemPrompt: prefs.get('autonomyGlobalSystemPrompt') ?? DEFAULT_GLOBAL_SYSTEM_PROMPT,
    rateCapPerMin: prefs.get('autonomyGlobalRateCapPerMin') ?? 20,
    visionEnabled: prefs.get('autonomyVisionEnabled') ?? false,
    model: prefs.get('autonomyModel') ?? '',
  });

  ipcMain.handle(IPC_CHANNELS['autonomy.detect'], async () => host.detect());

  ipcMain.handle(IPC_CHANNELS['autonomy.getGuildConfig'], async (_, guildId: unknown): Promise<Result<GuildAutonomyConfig>> => {
    if (typeof guildId !== 'string') return err('INTERNAL', 'guildId must be a string');
    return ok(repo.getGuildConfig(guildId));
  });

  ipcMain.handle(IPC_CHANNELS['autonomy.setGuildConfig'], async (_, guildId: unknown, partial: unknown): Promise<Result<GuildAutonomyConfig>> => {
    if (typeof guildId !== 'string') return err('INTERNAL', 'guildId must be a string');
    if (!partial || typeof partial !== 'object') return err('INTERNAL', 'partial must be an object');
    const updated = repo.upsertGuildConfig(guildId, partial as Partial<GuildAutonomyConfig>);
    return ok(updated);
  });

  ipcMain.handle(IPC_CHANNELS['autonomy.getGlobalConfig'], async (): Promise<Result<GlobalAutonomyConfig>> => ok(readGlobal()));

  ipcMain.handle(IPC_CHANNELS['autonomy.setGlobalConfig'], async (_, partial: unknown): Promise<Result<GlobalAutonomyConfig>> => {
    if (!partial || typeof partial !== 'object') return err('INTERNAL', 'partial must be an object');
    const p = partial as Partial<GlobalAutonomyConfig>;
    if (typeof p.enabled === 'boolean') prefs.set('autonomyGlobalEnabled', p.enabled);
    if (typeof p.systemPrompt === 'string') prefs.set('autonomyGlobalSystemPrompt', p.systemPrompt);
    if (typeof p.rateCapPerMin === 'number' && p.rateCapPerMin > 0) prefs.set('autonomyGlobalRateCapPerMin', Math.floor(p.rateCapPerMin));
    if (typeof p.visionEnabled === 'boolean') prefs.set('autonomyVisionEnabled', p.visionEnabled);
    if (typeof p.model === 'string') prefs.set('autonomyModel', p.model);
    return ok(readGlobal());
  });

  ipcMain.handle(IPC_CHANNELS['autonomy.draftReply'], async (_, channelId: unknown, messageId: unknown): Promise<Result<{ requestId: string }>> => {
    if (typeof channelId !== 'string' || typeof messageId !== 'string') return err('INTERNAL', 'channelId and messageId must be strings');
    if (!readGlobal().enabled) return err('INTERNAL', 'autonomy globally disabled');

    const client = manager.getClient();
    if (!client) return err('GATEWAY_OFFLINE', 'bot not connected');

    let channel;
    try { channel = await client.channels.fetch(channelId); } catch (e) {
      return err('NOT_FOUND', e instanceof Error ? e.message : 'channel fetch failed');
    }
    if (!channel || !channel.isTextBased()) return err('NOT_FOUND', 'channel not text-based');

    let triggerMsg;
    try { triggerMsg = await channel.messages.fetch(messageId); } catch (e) {
      return err('NOT_FOUND', e instanceof Error ? e.message : 'message fetch failed');
    }

    const requestId = randomUUID();
    const visionEnabled = readGlobal().visionEnabled;
    void (async () => {
      if (!channel || !channel.isTextBased()) return;
      const cfg = repo.getGuildConfig(triggerMsg.guildId ?? '');
      const histLimit = Math.min(cfg.contextSize, 100);
      const fetched = await channel.messages.fetch({ limit: histLimit + 1, before: triggerMsg.id }).catch(() => null);
      const historyRaw = fetched
        ? Array.from(fetched.values())
            .filter(m => m.id !== triggerMsg.id)
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        : [];
      const history = await Promise.all(historyRaw.map(async m => {
        const { content } = await renderMessageContent(m, { vision: false, scratchDir });
        return {
          authorId: m.author.id,
          authorDisplayName: m.member?.displayName ?? m.author.globalName ?? m.author.username,
          authorUsername: m.author.username,
          isBot: m.author.bot ?? false,
          createdAt: m.createdTimestamp,
          content,
        };
      }));
      const channelMeta = {
        guildName: triggerMsg.guild?.name ?? '(direct message)',
        channelName: 'name' in channel && typeof channel.name === 'string' ? channel.name : 'channel',
        channelTopic: 'topic' in channel && typeof channel.topic === 'string' ? channel.topic : null,
      };
      const target = await renderMessageContent(triggerMsg, { vision: visionEnabled, scratchDir });
      try {
        await autonomy.draftReply({
          requestId,
          channelMeta,
          history,
          target: {
            id: triggerMsg.id,
            authorId: triggerMsg.author.id,
            authorDisplayName: triggerMsg.member?.displayName ?? triggerMsg.author.globalName ?? triggerMsg.author.username,
            authorUsername: triggerMsg.author.username,
            isBot: triggerMsg.author.bot ?? false,
            createdAt: triggerMsg.createdTimestamp,
            content: target.content,
          },
        });
      } finally {
        await target.cleanup();
      }
    })();
    return ok({ requestId });
  });

  ipcMain.handle(IPC_CHANNELS['autonomy.cancelDraft'], async (_, requestId: unknown): Promise<Result<void>> => {
    if (typeof requestId !== 'string') return err('INTERNAL', 'requestId must be a string');
    await autonomy.cancelDraft(requestId);
    return ok(undefined);
  });
}
