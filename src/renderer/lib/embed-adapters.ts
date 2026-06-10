import type { EmbedPayload, MessageEmbedSummary } from '../../shared/domain';

// EmbedPayload (compose/send input) -> MessageEmbedSummary (what EmbedCard renders).
// Fills the summary-only fields EmbedCard expects but the payload never carries.
export function payloadToSummary(p: EmbedPayload): MessageEmbedSummary {
  return {
    type: 'rich',
    title: p.title ?? null,
    description: p.description ?? null,
    url: p.url ?? null,
    color: typeof p.color === 'number' ? p.color : null,
    image: p.image ? { url: p.image.url, width: null, height: null } : null,
    thumbnail: p.thumbnail ? { url: p.thumbnail.url, width: null, height: null } : null,
    author: p.author
      ? { name: p.author.name, url: p.author.url ?? null, iconUrl: p.author.iconUrl ?? null }
      : null,
    footer: p.footer ? { text: p.footer.text, iconUrl: p.footer.iconUrl ?? null } : null,
    provider: null,
    timestamp: p.timestamp ? Date.parse(p.timestamp) : null,
    video: null,
    fields: (p.fields ?? []).map(f => ({ name: f.name, value: f.value, inline: f.inline ?? false })),
  };
}

// MessageEmbedSummary (a sent message's embed) -> EmbedPayload (editable form input).
// Drops auto-generated fields (provider, video, image/thumbnail dimensions).
export function summaryToPayload(s: MessageEmbedSummary): EmbedPayload {
  const out: EmbedPayload = {};
  if (s.title) out.title = s.title;
  if (s.description) out.description = s.description;
  if (s.url) out.url = s.url;
  if (s.color != null) out.color = s.color;
  if (s.timestamp != null) out.timestamp = new Date(s.timestamp).toISOString();
  if (s.footer) {
    out.footer = s.footer.iconUrl ? { text: s.footer.text, iconUrl: s.footer.iconUrl } : { text: s.footer.text };
  }
  if (s.author) {
    const a: { name: string; url?: string; iconUrl?: string } = { name: s.author.name };
    if (s.author.url) a.url = s.author.url;
    if (s.author.iconUrl) a.iconUrl = s.author.iconUrl;
    out.author = a;
  }
  if (s.thumbnail) out.thumbnail = { url: s.thumbnail.url };
  if (s.image) out.image = { url: s.image.url };
  if (s.fields.length) out.fields = s.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
  return out;
}
