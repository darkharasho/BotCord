import { ipcMain } from 'electron';
import { EmbedBuilder, type Message } from 'discord.js';

type SendableChannel = {
  send: (opts: { content?: string | undefined; embeds?: EmbedBuilder[] }) => Promise<Message>;
  messages: {
    fetch: ((opts: { limit: number; before?: string }) => Promise<Map<string, Message>>) &
           ((id: string) => Promise<Message>);
  };
  bulkDelete?: (ids: string[], filterOld?: boolean) => Promise<Map<string, Message>>;
};
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { EmbedPayload, MessageSummary } from '../../shared/domain';
import type { IpcDeps } from './index';

const summarize = (m: Message): MessageSummary => ({
  id: m.id,
  channelId: m.channelId,
  authorId: m.author.id,
  authorTag: `${m.author.username}#${m.author.discriminator}`,
  content: m.content,
  createdAt: m.createdTimestamp,
  editedAt: m.editedTimestamp,
  hasEmbeds: m.embeds.length > 0,
  hasAttachments: m.attachments.size > 0,
});

const buildEmbed = (p: EmbedPayload): EmbedBuilder => {
  const e = new EmbedBuilder();
  if (p.title) e.setTitle(p.title);
  if (p.description) e.setDescription(p.description);
  if (p.url) e.setURL(p.url);
  if (typeof p.color === 'number') e.setColor(p.color);
  if (p.timestamp) e.setTimestamp(new Date(p.timestamp));
  if (p.footer) e.setFooter(p.footer.iconUrl ? { text: p.footer.text, iconURL: p.footer.iconUrl } : { text: p.footer.text });
  if (p.author) {
    const a: { name: string; url?: string; iconURL?: string } = { name: p.author.name };
    if (p.author.url) a.url = p.author.url;
    if (p.author.iconUrl) a.iconURL = p.author.iconUrl;
    e.setAuthor(a);
  }
  if (p.thumbnail) e.setThumbnail(p.thumbnail.url);
  if (p.image) e.setImage(p.image.url);
  if (p.fields?.length) e.addFields(p.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline ?? false })));
  return e;
};

export function registerMessageHandlers({ manager }: IpcDeps): void {
  const requireSendableChannel = async (channelId: string): Promise<{ ok: true; channel: SendableChannel } | Result<never>> => {
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || !('send' in ch) || typeof (ch as SendableChannel).send !== 'function') {
      return err('NOT_FOUND', `Channel ${channelId} is not a sendable text channel`);
    }
    return { ok: true, channel: ch as SendableChannel };
  };

  ipcMain.handle(IPC_CHANNELS['messages.send'], async (_, channelId: unknown, content: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof content !== 'string') return err('INTERNAL', 'invalid arguments');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    try {
      const msg = await (got as { ok: true; channel: SendableChannel }).channel.send({ content });
      return ok(summarize(msg));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.sendEmbed'], async (_, channelId: unknown, embed: unknown, content?: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof embed !== 'object' || embed === null) return err('INTERNAL', 'invalid arguments');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    try {
      const msg = await (got as { ok: true; channel: SendableChannel }).channel.send({
        content: typeof content === 'string' ? content : undefined,
        embeds: [buildEmbed(embed as EmbedPayload)],
      });
      return ok(summarize(msg));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.history'], async (_, channelId: unknown, opts: unknown): Promise<Result<MessageSummary[]>> => {
    if (typeof channelId !== 'string' || typeof opts !== 'object' || opts === null) return err('INTERNAL', 'invalid arguments');
    const o = opts as { before?: string; limit: number };
    if (typeof o.limit !== 'number' || o.limit < 1 || o.limit > 100) return err('INTERNAL', 'limit must be 1-100');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary[]>;
    try {
      const fetchOpts: { limit: number; before?: string } = { limit: o.limit };
      if (o.before) fetchOpts.before = o.before;
      const messages = await (got as { ok: true; channel: SendableChannel }).channel.messages.fetch(fetchOpts);
      return ok(Array.from(messages.values()).map(summarize));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.delete'], async (_, channelId: unknown, messageId: unknown): Promise<Result<void>> => {
    if (typeof channelId !== 'string' || typeof messageId !== 'string') return err('INTERNAL', 'invalid arguments');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<void>;
    try {
      const msg = await (got as { ok: true; channel: SendableChannel }).channel.messages.fetch(messageId);
      await msg.delete();
      return ok(undefined);
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.bulkDelete'], async (_, channelId: unknown, messageIds: unknown): Promise<Result<{ deleted: string[] }>> => {
    if (typeof channelId !== 'string' || !Array.isArray(messageIds)) return err('INTERNAL', 'invalid arguments');
    const ids = messageIds.filter((v): v is string => typeof v === 'string');
    if (ids.length === 0) return ok({ deleted: [] });
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<{ deleted: string[] }>;
    const channel = (got as { ok: true; channel: SendableChannel }).channel;
    if (!('bulkDelete' in channel) || typeof (channel as { bulkDelete: unknown }).bulkDelete !== 'function') {
      return err('MISSING_PERMISSIONS', 'Channel does not support bulk delete');
    }
    try {
      const result = await (channel as unknown as { bulkDelete: (ids: string[], filterOld?: boolean) => Promise<Map<string, Message>> })
        .bulkDelete(ids, true);
      return ok({ deleted: Array.from(result.keys()) });
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });
}
