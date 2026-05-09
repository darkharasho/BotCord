import { describe, it, expect } from 'vitest';
import { renderMessageContent } from '../message-render';

type Coll<T> = { values(): IterableIterator<T> };
const coll = <T>(items: T[]): Coll<T> => ({ values: () => items[Symbol.iterator]() });

const baseMsg = (overrides: Partial<{
  content: string;
  attachments: Array<{ id: string; name: string | null; url: string; contentType: string | null; size: number }>;
  embeds: Array<{ data?: { type?: string }; title?: string | null; description?: string | null; url?: string | null; provider?: { name?: string } | null; image?: { url: string } | null; thumbnail?: { url: string } | null }>;
  stickers: Array<{ name: string }>;
  editedTimestamp: number | null;
}> = {}) => ({
  content: overrides.content ?? '',
  attachments: coll(overrides.attachments ?? []) as never,
  embeds: (overrides.embeds ?? []) as never,
  stickers: coll(overrides.stickers ?? []) as never,
  editedTimestamp: overrides.editedTimestamp ?? null,
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

  it('strips custom emoji ids — <:name:id> → :name:', async () => {
    const { content } = await renderMessageContent(
      baseMsg({ content: 'hello <:laughing:123456789> and <a:dance:987654321> too' }),
      { vision: false, scratchDir: '/tmp/x' },
    );
    expect(content).toBe('hello :laughing: and :dance: too');
  });

  it('leaves unicode emoji untouched', async () => {
    const { content } = await renderMessageContent(
      baseMsg({ content: 'lol 😂 yeah' }),
      { vision: false, scratchDir: '/tmp/x' },
    );
    expect(content).toBe('lol 😂 yeah');
  });

  it('resolves user mentions and tags them with [ping <@id>] so plain-text names stay distinguishable', async () => {
    const mentions = {
      users: new Map([['111', 'HaroBot'], ['222', 'Harasho']]),
      roles: new Map<string, string>(),
      channels: new Map<string, string>(),
    };
    const { content } = await renderMessageContent(
      baseMsg({ content: '<@111> is <@!222> your favourite person? not harasho the plain word' }),
      { vision: false, scratchDir: '/tmp/x', mentions },
    );
    expect(content).toBe('@HaroBot [ping <@111>] is @Harasho [ping <@222>] your favourite person? not harasho the plain word');
  });

  it('resolves role mentions and channel references', async () => {
    const mentions = {
      users: new Map<string, string>(),
      roles: new Map([['555', 'mods']]),
      channels: new Map([['666', 'general']]),
    };
    const { content } = await renderMessageContent(
      baseMsg({ content: 'hey <@&555> see <#666>' }),
      { vision: false, scratchDir: '/tmp/x', mentions },
    );
    expect(content).toBe('hey @mods [role-ping <@&555>] see #general');
  });

  it('leaves unknown mention IDs untouched rather than fabricating a name', async () => {
    const mentions = { users: new Map(), roles: new Map(), channels: new Map() };
    const { content } = await renderMessageContent(
      baseMsg({ content: 'who is <@999>?' }),
      { vision: false, scratchDir: '/tmp/x', mentions },
    );
    expect(content).toBe('who is <@999>?');
  });

  it('cleanup is a no-op when vision is off', async () => {
    const { cleanup } = await renderMessageContent(baseMsg({ content: 'hi' }), { vision: false, scratchDir: '/tmp/x' });
    await expect(cleanup()).resolves.toBeUndefined();
  });
});
