import { describe, it, expect } from 'vitest';
import { payloadToSummary, summaryToPayload } from '../embed-adapters';
import type { EmbedPayload, MessageEmbedSummary } from '../../../shared/domain';

describe('payloadToSummary', () => {
  it('maps a full payload and fills summary-only fields', () => {
    const p: EmbedPayload = {
      title: 'T', description: 'D', url: 'https://x.test', color: 0x007f68,
      timestamp: '2026-06-10T00:00:00.000Z',
      footer: { text: 'F', iconUrl: 'https://i.test/f.png' },
      author: { name: 'A', url: 'https://a.test', iconUrl: 'https://i.test/a.png' },
      thumbnail: { url: 'https://i.test/t.png' },
      image: { url: 'https://i.test/img.png' },
      fields: [{ name: 'N', value: 'V', inline: true }],
    };
    const s = payloadToSummary(p);
    expect(s.type).toBe('rich');
    expect(s.title).toBe('T');
    expect(s.color).toBe(0x007f68);
    expect(s.timestamp).toBe(Date.parse('2026-06-10T00:00:00.000Z'));
    expect(s.image).toEqual({ url: 'https://i.test/img.png', width: null, height: null });
    expect(s.author).toEqual({ name: 'A', url: 'https://a.test', iconUrl: 'https://i.test/a.png' });
    expect(s.footer).toEqual({ text: 'F', iconUrl: 'https://i.test/f.png' });
    expect(s.fields).toEqual([{ name: 'N', value: 'V', inline: true }]);
    expect(s.provider).toBeNull();
    expect(s.video).toBeNull();
  });

  it('maps an empty payload to all-null with empty fields', () => {
    const s = payloadToSummary({});
    expect(s.title).toBeNull();
    expect(s.color).toBeNull();
    expect(s.timestamp).toBeNull();
    expect(s.fields).toEqual([]);
  });
});

describe('summaryToPayload', () => {
  it('drops auto fields and converts timestamp to ISO', () => {
    const s: MessageEmbedSummary = {
      type: 'rich', title: 'T', description: null, url: null, color: 0x123456,
      image: { url: 'https://i.test/img.png', width: 100, height: 50 },
      thumbnail: null,
      author: { name: 'A', url: null, iconUrl: null },
      footer: { text: 'F', iconUrl: null },
      provider: { name: 'P', url: null },
      timestamp: Date.parse('2026-06-10T00:00:00.000Z'),
      video: { url: 'https://v.test', width: null, height: null },
      fields: [{ name: 'N', value: 'V', inline: false }],
    };
    const p = summaryToPayload(s);
    expect(p.title).toBe('T');
    expect(p.color).toBe(0x123456);
    expect(p.timestamp).toBe('2026-06-10T00:00:00.000Z');
    expect(p.image).toEqual({ url: 'https://i.test/img.png' });
    expect(p.author).toEqual({ name: 'A' });
    expect(p.footer).toEqual({ text: 'F' });
    expect(p.fields).toEqual([{ name: 'N', value: 'V', inline: false }]);
    expect('description' in p).toBe(false);
  });

  it('round-trips a payload through summary and back', () => {
    const p: EmbedPayload = {
      title: 'T', description: 'D', color: 0x007f68,
      fields: [{ name: 'N', value: 'V', inline: true }],
    };
    expect(summaryToPayload(payloadToSummary(p))).toEqual(p);
  });
});
