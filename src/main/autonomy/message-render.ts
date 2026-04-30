import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { pathToFileURL } from 'url';
import type { Message } from 'discord.js';

const IMAGE_MIME_PREFIX = 'image/';

type AttachmentLike = {
  id: string;
  name: string | null;
  url: string;
  contentType: string | null;
  size: number;
};

type EmbedLike = {
  type: string | null | undefined;
  title: string | null;
  description: string | null;
  url: string | null;
  provider: { name: string } | null;
  image: { url: string } | null;
  thumbnail: { url: string } | null;
};

const isImage = (att: AttachmentLike): boolean => {
  if (att.contentType?.startsWith(IMAGE_MIME_PREFIX)) return true;
  const lower = att.name?.toLowerCase() ?? '';
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(lower);
};

const summarizeAttachment = (att: AttachmentLike): string => {
  if (isImage(att)) return `[image: ${att.name ?? att.id}]`;
  return `[attachment: ${att.name ?? att.id}]`;
};

const summarizeEmbed = (e: EmbedLike): string | null => {
  // Tenor / Giphy come through as embeds with type 'gifv' or 'image'
  if (e.type === 'gifv' || (e.url && /tenor|giphy/.test(e.url))) {
    return `[gif${e.url ? ` ${e.url}` : ''}]`;
  }
  if (e.title || e.description) {
    const parts = [e.title, e.description].filter(Boolean).join(' — ');
    return `[link: ${parts}${e.url ? ` (${e.url})` : ''}]`;
  }
  if (e.url) return `[link: ${e.url}]`;
  return null;
};

type Sticker = { name: string };
const summarizeStickers = (stickers: Sticker[]): string[] =>
  stickers.map(s => `[sticker: ${s.name}]`);

/**
 * Renders a discord.js Message into a plain-text content blob suitable for
 * the autonomy prompt. Always appends short markers for attachments,
 * embeds, and stickers so Claude has *some* signal beyond the raw text.
 *
 * If `vision` is true and the message has image attachments, downloads
 * each image into `scratchDir/<requestId>/` and inlines a markdown
 * `![](file://…)` reference that the local claude CLI will read off
 * disk as vision input.
 *
 * Returns the enriched content string and a `cleanup` function the
 * caller must invoke once the autonomy session has completed.
 */
export async function renderMessageContent(
  m: Pick<Message, 'content' | 'attachments' | 'embeds' | 'stickers'>,
  opts: { vision: boolean; scratchDir: string },
): Promise<{ content: string; cleanup: () => Promise<void> }> {
  const attachments: AttachmentLike[] = Array.from(m.attachments.values()).map(a => ({
    id: a.id,
    name: a.name ?? null,
    url: a.url,
    contentType: a.contentType ?? null,
    size: a.size,
  }));
  const embeds: EmbedLike[] = m.embeds.map(e => ({
    type: (e.data as { type?: string } | undefined)?.type ?? null,
    title: e.title ?? null,
    description: e.description ?? null,
    url: e.url ?? null,
    provider: e.provider ? { name: e.provider.name ?? '' } : null,
    image: e.image ? { url: e.image.url } : null,
    thumbnail: e.thumbnail ? { url: e.thumbnail.url } : null,
  }));
  const stickers: Sticker[] = Array.from(m.stickers.values()).map(s => ({ name: s.name }));

  const lines: string[] = [];
  if (m.content) lines.push(m.content);

  // Vision: download image attachments + inline file:// references
  let visionDir: string | null = null;
  const cleanups: Array<() => Promise<void>> = [];
  if (opts.vision) {
    const imageAtts = attachments.filter(isImage);
    if (imageAtts.length > 0) {
      visionDir = join(opts.scratchDir, 'vision', randomUUID());
      await mkdir(visionDir, { recursive: true });
      for (const att of imageAtts) {
        try {
          const res = await fetch(att.url);
          if (!res.ok) { lines.push(summarizeAttachment(att)); continue; }
          const buf = Buffer.from(await res.arrayBuffer());
          const safeName = (att.name ?? `${att.id}.bin`).replace(/[^\w.\-]/g, '_');
          const filePath = join(visionDir, safeName);
          await writeFile(filePath, buf);
          lines.push(`![${att.name ?? 'image'}](${pathToFileURL(filePath).toString()})`);
        } catch {
          lines.push(summarizeAttachment(att));
        }
      }
      cleanups.push(async () => { if (visionDir) { await rm(visionDir, { recursive: true, force: true }).catch(() => {}); } });
    }
    // Non-image attachments still get a text marker
    for (const att of attachments) if (!isImage(att)) lines.push(summarizeAttachment(att));
  } else {
    for (const att of attachments) lines.push(summarizeAttachment(att));
  }

  for (const e of embeds) {
    const s = summarizeEmbed(e);
    if (s) lines.push(s);
  }
  lines.push(...summarizeStickers(stickers));

  return {
    content: lines.join('\n').trim(),
    cleanup: async () => { for (const c of cleanups) await c(); },
  };
}
