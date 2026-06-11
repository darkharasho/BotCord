import { describe, it, expect, vi } from 'vitest';
import type { AttachmentBuilder } from 'discord.js';
import { rehostDiscordAttachmentUrls } from '../embed-rehost';
import type { EmbedPayload } from '../../../shared/domain';

const CDN = 'https://cdn.discordapp.com/attachments/1/2/pic.png?ex=abc&is=def&hm=ghi&';
const okFetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));

describe('rehostDiscordAttachmentUrls', () => {
  it('rewrites a discord cdn image url to a fresh attachment upload', async () => {
    const p: EmbedPayload = { image: { url: CDN } };
    const files: AttachmentBuilder[] = [];
    await rehostDiscordAttachmentUrls(p, files, okFetch as unknown as typeof fetch);
    expect(p.image).toEqual({ url: 'attachment://image.png' });
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe('image.png');
  });

  it('rehosts author and footer icons with their slot basenames', async () => {
    const p: EmbedPayload = {
      author: { name: 'A', iconUrl: CDN },
      footer: { text: 'F', iconUrl: 'https://media.discordapp.net/attachments/1/2/icon.webp' },
    };
    const files: AttachmentBuilder[] = [];
    await rehostDiscordAttachmentUrls(p, files, okFetch as unknown as typeof fetch);
    expect(p.author).toEqual({ name: 'A', iconUrl: 'attachment://author-icon.png' });
    expect(p.footer).toEqual({ text: 'F', iconUrl: 'attachment://footer-icon.webp' });
    expect(files.map(f => f.name)).toEqual(['author-icon.png', 'footer-icon.webp']);
  });

  it('leaves external urls and attachment:// references untouched', async () => {
    const p: EmbedPayload = {
      image: { url: 'https://example.com/pic.png' },
      thumbnail: { url: 'attachment://thumbnail.png' },
    };
    const files: AttachmentBuilder[] = [];
    const fetchSpy = vi.fn();
    await rehostDiscordAttachmentUrls(p, files, fetchSpy as unknown as typeof fetch);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(p.image!.url).toBe('https://example.com/pic.png');
    expect(p.thumbnail!.url).toBe('attachment://thumbnail.png');
    expect(files).toHaveLength(0);
  });

  it('keeps the original url when the fetch fails', async () => {
    const p: EmbedPayload = { image: { url: CDN } };
    const files: AttachmentBuilder[] = [];
    const failing = vi.fn(async () => { throw new Error('net down'); });
    await rehostDiscordAttachmentUrls(p, files, failing as unknown as typeof fetch);
    expect(p.image!.url).toBe(CDN);
    expect(files).toHaveLength(0);
  });

  it('avoids filename collisions with already-queued uploads', async () => {
    const p: EmbedPayload = { image: { url: CDN } };
    const files = [{ name: 'image.png' }] as unknown as AttachmentBuilder[];
    await rehostDiscordAttachmentUrls(p, files, okFetch as unknown as typeof fetch);
    expect(p.image).toEqual({ url: 'attachment://image-1.png' });
  });
});
