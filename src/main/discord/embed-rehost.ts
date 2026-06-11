import { AttachmentBuilder } from 'discord.js';
import type { EmbedPayload } from '../../shared/domain';

const DISCORD_ATTACHMENT_RE = /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\//;

// Discord stores embeds that reference its own attachment CDN urls without
// re-measuring them (width/height come back 0), and the official client sizes
// embed media from those dimensions — a 0×0 image renders as nothing. This
// bites every re-edit of an embed whose media was originally uploaded as a
// file: the app reads back the resolved CDN url and innocently sends it as a
// plain url. Re-host such urls as fresh uploads so Discord re-processes them.
// Mutates `payload` in place and appends the new uploads to `files`.
export async function rehostDiscordAttachmentUrls(
  payload: EmbedPayload,
  files: AttachmentBuilder[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const taken = new Set(files.map(f => f.name).filter((n): n is string => !!n));
  const rehost = async (url: string, basename: string): Promise<string | null> => {
    if (!DISCORD_ATTACHMENT_RE.test(url)) return null;
    try {
      const res = await fetchImpl(url);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = (url.split('?')[0]!.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'png').toLowerCase();
      let name = `${basename}.${ext}`;
      for (let n = 1; taken.has(name); n++) name = `${basename}-${n}.${ext}`;
      taken.add(name);
      files.push(new AttachmentBuilder(buf, { name }));
      return `attachment://${name}`;
    } catch {
      return null; // unreachable url — keep the original and let Discord cope
    }
  };
  if (payload.image?.url) {
    const u = await rehost(payload.image.url, 'image');
    if (u) payload.image = { url: u };
  }
  if (payload.thumbnail?.url) {
    const u = await rehost(payload.thumbnail.url, 'thumbnail');
    if (u) payload.thumbnail = { url: u };
  }
  if (payload.author?.iconUrl) {
    const u = await rehost(payload.author.iconUrl, 'author-icon');
    if (u) payload.author = { ...payload.author, iconUrl: u };
  }
  if (payload.footer?.iconUrl) {
    const u = await rehost(payload.footer.iconUrl, 'footer-icon');
    if (u) payload.footer = { ...payload.footer, iconUrl: u };
  }
}
