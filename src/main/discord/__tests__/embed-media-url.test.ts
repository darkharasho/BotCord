// Discord echoes `attachment://<name>` embed urls back verbatim — the
// renderable link lives in the proxy field or the message's attachment list.
import { describe, it, expect } from 'vitest';
import { resolveEmbedMediaUrl } from '../client-manager';

describe('resolveEmbedMediaUrl', () => {
  const atts = [{ name: 'author-icon.png', url: 'https://cdn.discordapp.com/attachments/1/2/author-icon.png' }];

  it('passes plain https urls through', () => {
    expect(resolveEmbedMediaUrl('https://x.test/a.png', null, atts)).toBe('https://x.test/a.png');
  });

  it('returns null for a missing url', () => {
    expect(resolveEmbedMediaUrl(null, 'https://proxy.test/p.png', atts)).toBeNull();
    expect(resolveEmbedMediaUrl(undefined, null, atts)).toBeNull();
  });

  it('prefers the proxy url for attachment:// references', () => {
    expect(resolveEmbedMediaUrl('attachment://author-icon.png', 'https://media.discordapp.net/p.png', atts))
      .toBe('https://media.discordapp.net/p.png');
  });

  it('falls back to the matching attachment url when no proxy', () => {
    expect(resolveEmbedMediaUrl('attachment://author-icon.png', null, atts))
      .toBe('https://cdn.discordapp.com/attachments/1/2/author-icon.png');
  });

  it('returns the raw reference when nothing matches', () => {
    expect(resolveEmbedMediaUrl('attachment://missing.png', null, atts)).toBe('attachment://missing.png');
  });
});
