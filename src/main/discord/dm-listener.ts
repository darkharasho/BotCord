import { Events, ChannelType } from 'discord.js';
import type { Client, Message, DMChannel } from 'discord.js';
import type { DMChannelsRepo } from '../db/repos/dm-channels';

const MAX_PREVIEW = 200;
const BACKFILL_CONCURRENCY = 4;
const BACKFILL_PAGE_SIZE = 100;

const isDM = (m: { channel?: { type?: number } | null; guildId?: string | null }): boolean => {
  if (m.channel?.type === ChannelType.DM) return true;
  // First-time DMs arrive with a partial channel whose type may not be set yet;
  // fall back to guildId === null (DMs have no guild).
  if (m.channel == null && (m.guildId === null || m.guildId === undefined)) return true;
  return false;
};

const previewOf = (content: string, hasAttachments: boolean, hasEmbeds: boolean): string => {
  const trimmed = content.trim();
  if (trimmed.length > 0) return trimmed.slice(0, MAX_PREVIEW);
  if (hasAttachments) return '[attachment]';
  if (hasEmbeds) return '[embed]';
  return '';
};

function upsertFromMessage(repo: DMChannelsRepo, m: Message): void {
  const author = m.author as unknown as { id: string; bot: boolean; username: string; globalName: string | null; displayAvatarURL: (o?: { size: number }) => string };
  const channel = m.channel as DMChannel | null | undefined;
  // If the channel is partial/null we still know the author — for inbound DMs
  // (author is not the bot) the author IS the recipient. For outbound DMs we
  // need the channel.recipient.
  const recipient = author.bot ? (channel?.recipient ?? null) : author;
  if (!recipient) return;
  const r = recipient as unknown as { id: string; username: string; globalName: string | null; displayAvatarURL: (o?: { size: number }) => string };

  repo.upsert({
    channelId: m.channelId,
    userId: r.id,
    userUsername: r.username,
    userGlobalName: r.globalName ?? null,
    userAvatar: r.displayAvatarURL({ size: 128 }),
    lastMessageId: m.id,
    lastMessagePreview: previewOf(
      m.content ?? '',
      ((m.attachments as unknown as { size?: number })?.size ?? 0) > 0,
      (m.embeds?.length ?? 0) > 0,
    ),
  });
}

export function attachDMListener(client: Client, repo: DMChannelsRepo): { runBackfill: () => Promise<void> } {
  client.on(Events.MessageCreate, (m: Message) => {
    if (!isDM(m)) return;
    console.log('[dm-listener] DM messageCreate', { channelId: m.channelId, authorId: m.author?.id, hasChannel: !!m.channel, channelType: m.channel?.type });
    upsertFromMessage(repo, m);
  });

  client.on(Events.MessageUpdate, (_old, mNew) => {
    const m = mNew as Message;
    if (m.partial) {
      m.fetch().then(full => { if (isDM(full)) upsertFromMessage(repo, full); }).catch(() => { /* ignore */ });
      return;
    }
    if (!isDM(m)) return;
    upsertFromMessage(repo, m);
  });

  const runBackfill = async (): Promise<void> => {
    const rows = repo.list();
    let cursor = 0;
    const workers = Array.from({ length: BACKFILL_CONCURRENCY }, async () => {
      while (cursor < rows.length) {
        const idx = cursor++;
        const row = rows[idx]!;
        try {
          const ch = await client.channels.fetch(row.channelId).catch((e: { code?: number } | Error) => {
            const code = (e as { code?: number }).code;
            if (code === 10003) {
              repo.markInert(row.channelId);
              return null;
            }
            throw e;
          });
          if (!ch || ch.type !== ChannelType.DM) continue;
          const dm = ch as DMChannel;
          let after = row.lastMessageId ?? undefined;
          for (let i = 0; i < 50; i++) {
            const opts: { limit: number; after?: string } = { limit: BACKFILL_PAGE_SIZE };
            if (after) opts.after = after;
            const messages = await dm.messages.fetch(opts);
            if (messages.size === 0) break;
            const ordered = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            for (const m of ordered) {
              if (isDM(m)) upsertFromMessage(repo, m);
              client.emit(Events.MessageCreate, m as never);
            }
            const newest = ordered[ordered.length - 1]!;
            after = newest.id;
            if (messages.size < BACKFILL_PAGE_SIZE) break;
          }
        } catch (e) {
          console.warn('[dm-listener] backfill failed for', row.channelId, e);
        }
      }
    });
    await Promise.all(workers);
  };

  return { runBackfill };
}
