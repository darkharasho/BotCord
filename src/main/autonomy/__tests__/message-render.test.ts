import { describe, it, expect } from 'vitest';
import { renderMessageContent } from '../message-render';

type Coll<T> = { values(): IterableIterator<T> };
const coll = <T>(items: T[]): Coll<T> => ({ values: () => items[Symbol.iterator]() });

const baseMsg = (overrides: Partial<{
  content: string;
  attachments: Array<{ id: string; name: string | null; url: string; contentType: string | null; size: number }>;
  embeds: Array<{ data?: { type?: string }; title?: string | null; description?: string | null; url?: string | null; provider?: { name?: string } | null; image?: { url: string } | null; thumbnail?: { url: string } | null }>;
  stickers: Array<{ name: string }>;
}> = {}) => ({
  content: overrides.content ?? '',
  attachments: coll(overrides.attachments ?? []) as never,
  embeds: (overrides.embeds ?? []) as never,
  stickers: coll(overrides.stickers ?? []) as never,
});

describe('renderMessageContent (vision off)', () => {
  it('passes plain text through unchanged', async () => {
    const { content } = await renderMessageContent(baseMsg({ content: 'hello there' }), { vision: false, scratchDir: '/tmp/x' });
    expect(content).toBe('hello there');
  });

  it('marks image attachments without downloading', async () => {
    const { content } = await renderMessageContent(
      baseMsg({
        content: 'look at this',
        attachments: [{ id: 'a1', name: 'cat.png', url: 'https://cdn.discordapp.com/cat.png', contentType: 'image/png', size: 1234 }],
      }),
      { vision: false, scratchDir: '/tmp/x' },
    );
    expect(content).toContain('look at this');
    expect(content).toContain('[image: cat.png]');
    expect(content).not.toContain('file://');
  });

  it('marks non-image attachments distinctly', async () => {
    const { content } = await renderMessageContent(
      baseMsg({ attachments: [{ id: 'a1', name: 'doc.pdf', url: 'x', contentType: 'application/pdf', size: 1 }] }),
      { vision: false, scratchDir: '/tmp/x' },
    );
    expect(content).toContain('[attachment: doc.pdf]');
  });

  it('detects images by extension when contentType is missing', async () => {
    const { content } = await renderMessageContent(
      baseMsg({ attachments: [{ id: 'a1', name: 'pic.JPG', url: 'x', contentType: null, size: 1 }] }),
      { vision: false, scratchDir: '/tmp/x' },
    );
    expect(content).toContain('[image: pic.JPG]');
  });

  it('renders Tenor/Giphy embeds as gif markers', async () => {
    const { content } = await renderMessageContent(
      baseMsg({ embeds: [{ data: { type: 'gifv' }, url: 'https://tenor.com/x.gif' }] }),
      { vision: false, scratchDir: '/tmp/x' },
    );
    expect(content).toContain('[gif https://tenor.com/x.gif]');
  });

  it('renders link-preview embeds with title + description', async () => {
    const { content } = await renderMessageContent(
      baseMsg({ embeds: [{ title: 'Cool article', description: 'about cats', url: 'https://example.com/x' }] }),
      { vision: false, scratchDir: '/tmp/x' },
    );
    expect(content).toMatch(/\[link: Cool article — about cats \(https:\/\/example\.com\/x\)\]/);
  });

  it('renders stickers by name', async () => {
    const { content } = await renderMessageContent(
      baseMsg({ stickers: [{ name: 'PartyParrot' }] }),
      { vision: false, scratchDir: '/tmp/x' },
    );
    expect(content).toContain('[sticker: PartyParrot]');
  });

  it('combines text + attachment + embed + sticker on separate lines', async () => {
    const { content } = await renderMessageContent(
      baseMsg({
        content: 'text',
        attachments: [{ id: 'a', name: 'pic.png', url: 'x', contentType: 'image/png', size: 1 }],
        embeds: [{ title: 'Title', url: 'https://e.com' }],
        stickers: [{ name: 'Wow' }],
      }),
      { vision: false, scratchDir: '/tmp/x' },
    );
    const lines = content.split('\n');
    expect(lines[0]).toBe('text');
    expect(lines).toContain('[image: pic.png]');
    expect(lines.some(l => l.startsWith('[link: Title'))).toBe(true);
    expect(lines).toContain('[sticker: Wow]');
  });

  it('cleanup is a no-op when vision is off', async () => {
    const { cleanup } = await renderMessageContent(baseMsg({ content: 'hi' }), { vision: false, scratchDir: '/tmp/x' });
    await expect(cleanup()).resolves.toBeUndefined();
  });
});
