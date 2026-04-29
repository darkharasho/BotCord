// Renders Unicode emoji using the Twemoji SVG set — a flat, modern style
// (the same pack Discord ships). We point at the community-maintained
// `jdecked/twemoji` fork on jsDelivr since Twitter stopped publishing
// updates upstream. SVGs are vector so size is set via CSS / em-units.
//
// Coverage is good but not perfect — some Unicode 15+ emoji and certain
// sequence variations aren't in the asset set. We try a couple of common
// filename variants on a single emoji, then fall back to the native glyph
// rather than rendering a broken-image icon.

import { useState, type ReactNode } from 'react';

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

// Twemoji filename rule: ZWJ sequences keep all codepoints (including
// U+FE0F variation selectors); non-ZWJ sequences strip U+FE0F. This
// matches Twitter's canonical `toCodePoint` algorithm and resolves the
// majority of mismatches that produce broken images.
function buildPath(emoji: string, stripFe0f: boolean): string {
  const cps: string[] = [];
  for (const ch of emoji) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (stripFe0f && cp === 0xfe0f) continue;
    cps.push(cp.toString(16));
  }
  return cps.join('-');
}

export function toTwemojiPath(emoji: string): string {
  // ZWJ sequences keep FE0F; everything else strips it.
  const containsZWJ = emoji.includes('‍');
  return buildPath(emoji, !containsZWJ);
}

export function toTwemojiUrl(emoji: string): string {
  return `${CDN}/${toTwemojiPath(emoji)}.svg`;
}

// Single emoji <img> with a 2-step filename fallback (alternate FE0F
// stripping) and finally a native-text fallback so a missing SVG never
// surfaces as a broken image icon.
function TwemojiImg({ emoji, keyId }: { emoji: string; keyId: string }) {
  // 0: primary URL, 1: alternate FE0F variant, 2: native fallback.
  const [step, setStep] = useState(0);
  const containsZWJ = emoji.includes('‍');
  const primary = buildPath(emoji, !containsZWJ);
  const alternate = buildPath(emoji, containsZWJ); // flipped
  const path = step === 0 ? primary : alternate;
  if (step >= 2 || !path) {
    return <span key={keyId} className="inline-block align-text-bottom">{emoji}</span>;
  }
  return (
    <img
      key={keyId}
      src={`${CDN}/${path}.svg`}
      alt={emoji}
      draggable={false}
      className="inline-block align-text-bottom select-none"
      style={{ width: '1.2em', height: '1.2em' }}
      onError={() => setStep(s => s + 1)}
    />
  );
}

// Renders a single emoji character with native-text fallback when the
// Twemoji asset is missing. Takes the same className used for the <img>
// so the fallback span sizes correctly.
export function TwemojiOne({ char, className, fallbackClassName }: { char: string; className?: string; fallbackClassName?: string }) {
  const [step, setStep] = useState(0);
  const containsZWJ = char.includes('‍');
  const primary = buildPath(char, !containsZWJ);
  const alternate = buildPath(char, containsZWJ);
  const path = step === 0 ? primary : alternate;
  if (step >= 2 || !path) {
    return <span className={fallbackClassName ?? className}>{char}</span>;
  }
  return (
    <img
      src={`${CDN}/${path}.svg`}
      alt={char}
      draggable={false}
      className={className}
      onError={() => setStep(s => s + 1)}
    />
  );
}

// Walks `text`, splitting on emoji graphemes and emitting a flat array of
// strings (plain text) and JSX nodes (emoji <img>).
export function renderTwemoji(text: string, keyPrefix = ''): ReactNode[] {
  if (!text) return [];
  const out: ReactNode[] = [];
  let lastIdx = 0;
  let i = 0;
  for (const match of text.matchAll(EMOJI_RE)) {
    const start = match.index ?? 0;
    const emoji = match[0];
    if (start > lastIdx) out.push(text.slice(lastIdx, start));
    out.push(<TwemojiImg key={`${keyPrefix}-${i}`} keyId={`${keyPrefix}-${i}`} emoji={emoji} />);
    lastIdx = start + emoji.length;
    i += 1;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return out;
}
