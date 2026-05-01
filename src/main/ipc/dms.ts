import { ipcMain } from 'electron';
import { ChannelType, AttachmentBuilder, type DMChannel, type Message } from 'discord.js';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { DMChannelRow, GuildSummary, MessageSummary, SendAttachment } from '../../shared/domain';
import { summarizeMessage } from '../discord/client-manager';
import type { DMChannelsRepo } from '../db/repos/dm-channels';
import type { IpcDeps } from './index';

export type DMIpcDeps = IpcDeps & { dmRepo: DMChannelsRepo };

const requireDM = async (
  manager: IpcDeps['manager'],
  channelId: string,
): Promise<{ ok: true; channel: DMChannel } | Result<never>> => {
  const client = manager.getClient();
  if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.DM) return err('NOT_FOUND', `DM channel ${channelId} not found`);
  return { ok: true, channel: ch as DMChannel };
};

export function registerDMHandlers({ manager, dmRepo }: DMIpcDeps): void {
  ipcMain.handle(IPC_CHANNELS['dms.list'], async (_, opts: unknown): Promise<Result<DMChannelRow[]>> => {
    const includeInert = !!(opts && typeof opts === 'object' && (opts as { includeInert?: boolean }).includeInert);
    return ok(dmRepo.list({ includeInert }));
  });

  ipcMain.handle(IPC_CHANNELS['dms.fetchMessages'], async (_, channelId: unknown, opts: unknown): Promise<Result<MessageSummary[]>> => {
    if (typeof channelId !== 'string' || typeof opts !== 'object' || opts === null) return err('INTERNAL', 'invalid arguments');
    const o = opts as { before?: string; limit: number };
    if (typeof o.limit !== 'number' || o.limit < 1 || o.limit > 100) return err('INTERNAL', 'limit must be 1-100');
    const got = await requireDM(manager, channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary[]>;
    try {
      const fetchOpts: { limit: number; before?: string } = { limit: o.limit };
      if (o.before) fetchOpts.before = o.before;
      const messages = await (got as { ok: true; channel: DMChannel }).channel.messages.fetch(fetchOpts);
      return ok(Array.from(messages.values()).map(summarizeMessage));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['dms.openWithUser'], async (_, userId: unknown): Promise<Result<DMChannelRow>> => {
    if (typeof userId !== 'string') return err('INTERNAL', 'userId required');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    try {
      const user = await client.users.fetch(userId);
      const dm = await user.createDM();
      const row = dmRepo.upsert({
        channelId: dm.id,
        userId: user.id,
        userUsername: user.username,
        userGlobalName: (user as unknown as { globalName: string | null }).globalName,
        userAvatar: user.displayAvatarURL({ size: 128 }),
        lastMessageId: null,
        lastMessagePreview: null,
      });
      return ok(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/cannot send/i.test(msg) || /50007/.test(msg)) {
        return err('MISSING_PERMISSIONS', 'User has DMs disabled or shares no guilds with the bot');
      }
      return err('DISCORD_HTTP_ERROR', msg);
    }
  });

  ipcMain.handle(IPC_CHANNELS['dms.send'], async (_, channelId: unknown, content: unknown, opts: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof content !== 'string') return err('INTERNAL', 'invalid arguments');
    const got = await requireDM(manager, channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    const sendOpts: { content: string; reply?: { messageReference: string; failIfNotExists: boolean } } = { content };
    const r = (opts && typeof opts === 'object') ? (opts as { replyToMessageId?: unknown }).replyToMessageId : undefined;
    if (typeof r === 'string' && r) sendOpts.reply = { messageReference: r, failIfNotExists: false };
    try {
      const msg = await (got as { ok: true; channel: DMChannel }).channel.send(sendOpts);
      return ok(summarizeMessage(msg as Message));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['dms.sendWithAttachments'], async (_, channelId: unknown, content: unknown, attachments: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof content !== 'string' || !Array.isArray(attachments)) return err('INTERNAL', 'invalid arguments');
    const got = await requireDM(manager, channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    let files: AttachmentBuilder[];
    try {
      files = (attachments as SendAttachment[]).map((a, i) => {
        if (typeof a?.name !== 'string' || !(a.bytes instanceof Uint8Array)) throw new Error(`attachments[${i}] is malformed`);
        return new AttachmentBuilder(Buffer.from(a.bytes), { name: a.name });
      });
    } catch (e) {
      return err('INTERNAL', e instanceof Error ? e.message : String(e));
    }
    try {
      const sendOpts: { content?: string; files: AttachmentBuilder[] } = { files };
      if (content.length > 0) sendOpts.content = content;
      const msg = await (got as { ok: true; channel: DMChannel }).channel.send(sendOpts);
      return ok(summarizeMessage(msg as Message));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['dms.markRead'], async (_, channelId: unknown): Promise<Result<void>> => {
    if (typeof channelId !== 'string') return err('INTERNAL', 'channelId required');
    dmRepo.markRead(channelId);
    return ok(undefined);
  });

  ipcMain.handle(IPC_CHANNELS['dms.close'], async (_, channelId: unknown): Promise<Result<void>> => {
    if (typeof channelId !== 'string') return err('INTERNAL', 'channelId required');
    dmRepo.markInert(channelId);
    return ok(undefined);
  });

  ipcMain.handle(IPC_CHANNELS['dms.getMutualGuilds'], async (_, userId: unknown): Promise<Result<GuildSummary[]>> => {
    if (typeof userId !== 'string') return err('INTERNAL', 'userId required');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const matches: GuildSummary[] = [];
    for (const guild of client.guilds.cache.values()) {
      // Ensure the member roster is cached so the membership check is reliable.
      if (typeof guild.memberCount === 'number' && guild.members.cache.size < guild.memberCount) {
        try { await guild.members.fetch(); } catch { /* missing intent — fall through to cache check */ }
      }
      if (!guild.members.cache.has(userId)) continue;
      matches.push({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.icon?.startsWith('a_')
          ? guild.iconURL({ size: 64, extension: 'gif' })
          : guild.iconURL({ size: 64 }),
        memberCount: guild.memberCount,
      });
    }
    return ok(matches);
  });
}
