// Renders Unicode emoji using the Twemoji SVG set — a flat, modern style
// (the same pack Discord ships). We point at the community-maintained
// `jdecked/twemoji` fork on jsDelivr since Twitter stopped publishing
// updates upstream. SVGs are vector so size is set via CSS / em-units.

import type { ReactNode } from 'react';

const CDN = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg';

// Match any single grapheme that contains an emoji-presentation codepoint.
// We rely on `\p{RGI_Emoji}` (regional-grapheme-identifier emoji) which is
// the Unicode-defined set of well-formed emoji sequences (handles ZWJ
// families, flags, skin tones, keycaps). Falls back to extended pictographic
// if the engine doesn't support RGI.
const EMOJI_RE = (() => {
  try {
    return new RegExp('\\p{RGI_Emoji}', 'gv');
  } catch {
    return /\p{Extended_Pictographic}(‍\p{Extended_Pictographic})*/gu;
  }
})();

// Convert an emoji grapheme to its Twemoji filename. Codepoints are joined
// by `-`, with the variation selector U+FE0F stripped (Twemoji omits it
// from filenames). Keycap sequences (e.g. 1️⃣) keep U+20E3 verbatim.
export function toTwemojiPath(emoji: string): string {
  const cps: string[] = [];
  for (const ch of emoji) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp === 0xfe0f) continue;
    cps.push(cp.toString(16));
  }
  return cps.join('-');
}

export function toTwemojiUrl(emoji: string): string {
  return `${CDN}/${toTwemojiPath(emoji)}.svg`;
}

// Walks `text`, splitting on emoji graphemes and emitting a flat array of
// strings (plain text) and JSX nodes (emoji <img>). Sized at 1.2em so they
// sit visually balanced in any surrounding font size.
export function renderTwemoji(text: string, keyPrefix = ''): ReactNode[] {
  if (!text) return [];
  const out: ReactNode[] = [];
  let lastIdx = 0;
  let i = 0;
  for (const match of text.matchAll(EMOJI_RE)) {
    const start = match.index ?? 0;
    const emoji = match[0];
    if (start > lastIdx) out.push(text.slice(lastIdx, start));
    out.push(
      <img
        key={`${keyPrefix}-${i}`}
        src={toTwemojiUrl(emoji)}
        alt={emoji}
        draggable={false}
        className="inline-block align-text-bottom select-none"
        style={{ width: '1.2em', height: '1.2em' }}
      />
    );
    lastIdx = start + emoji.length;
    i += 1;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return out;
}
