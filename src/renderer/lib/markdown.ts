export type MdNode =
  | { type: 'text'; value: string }
  | { type: 'line_break' }
  | { type: 'bold'; children: MdNode[] }
  | { type: 'italic'; children: MdNode[] }
  | { type: 'strike'; children: MdNode[] }
  | { type: 'spoiler'; children: MdNode[] }
  | { type: 'code_inline'; value: string }
  | { type: 'code_block'; lang: string | null; value: string }
  | { type: 'blockquote'; children: MdNode[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: MdNode[] }
  | { type: 'link'; url: string; children: MdNode[] }
  | { type: 'mention_user'; id: string }
  | { type: 'mention_channel'; id: string }
  | { type: 'mention_role'; id: string }
  | { type: 'mention_broadcast'; name: 'everyone' | 'here' }
  | { type: 'custom_emoji'; name: string; id: string; animated: boolean };

export function parseMarkdown(input: string): MdNode[] {
  const out: MdNode[] = [];
  let i = 0;

  while (i < input.length) {
    // Fenced code block
    if (input.startsWith('```', i)) {
      const end = input.indexOf('```', i + 3);
      if (end !== -1) {
        const inner = input.slice(i + 3, end);
        const nl = inner.indexOf('\n');
        const lang = nl >= 0 ? inner.slice(0, nl).trim() : '';
        const code = nl >= 0 ? inner.slice(nl + 1) : inner;
        out.push({ type: 'code_block', lang: lang.length > 0 ? lang : null, value: code.replace(/\n$/, '') });
        i = end + 3;
        continue;
      }
    }

    // Blockquote (only at start of line)
    if ((i === 0 || input[i - 1] === '\n') && input.startsWith('> ', i)) {
      const lines: string[] = [];
      while (i < input.length && input.startsWith('> ', i)) {
        const nl = input.indexOf('\n', i);
        const lineEnd = nl === -1 ? input.length : nl;
        lines.push(input.slice(i + 2, lineEnd));
        i = nl === -1 ? input.length : nl + 1;
      }
      out.push({ type: 'blockquote', children: parseInline(lines.join('\n'), { preserveNewlines: true }) });
      continue;
    }

    // ATX-style heading (Discord supports #, ##, ###). Only valid at the
    // start of a line and must be followed by a space — `#emoji` isn't a
    // header. Captures whole-line content; inline (including emoji) is
    // parsed recursively so `# 🎉 Title` keeps the glyph inside the header.
    if (i === 0 || input[i - 1] === '\n') {
      const headingMatch = /^(#{1,3}) ([^\n]*)/.exec(input.slice(i));
      if (headingMatch) {
        const level = headingMatch[1]!.length as 1 | 2 | 3;
        const lineText = headingMatch[2]!;
        out.push({ type: 'heading', level, children: parseInline(lineText) });
        i += headingMatch[0].length;
        // Consume the trailing newline so the heading doesn't emit a stray
        // line_break right after it.
        if (input[i] === '\n') i += 1;
        continue;
      }
    }

    // Find the next block-level boundary (code fence, blockquote, or heading)
    let nextBlock = input.length;
    const nextCode = input.indexOf('```', i);
    if (nextCode !== -1 && nextCode < nextBlock) nextBlock = nextCode;
    const bq = input.indexOf('\n> ', i);
    if (bq !== -1 && bq + 1 < nextBlock) nextBlock = bq + 1;
    // Handle blockquote at position 0
    if (i === 0 && input.startsWith('> ')) nextBlock = i;
    // Headings: scan for `\n#`, `\n##`, `\n###` followed by a space.
    const headingBoundary = /\n(#{1,3}) /.exec(input.slice(i));
    if (headingBoundary && headingBoundary.index !== undefined) {
      const abs = i + headingBoundary.index + 1; // position of the `#`
      if (abs < nextBlock) nextBlock = abs;
    }

    const segment = input.slice(i, nextBlock);
    if (segment.length > 0) out.push(...parseInline(segment));
    i = nextBlock;
  }

  return out;
}

function parseInline(text: string, opts: { preserveNewlines?: boolean } = {}): MdNode[] {
  const out: MdNode[] = [];
  let i = 0;
  let buf = '';

  const flushBuf = () => {
    if (buf.length > 0) {
      out.push({ type: 'text', value: buf });
      buf = '';
    }
  };

  while (i < text.length) {
    const c = text[i]!;

    // Line break
    if (c === '\n') {
      if (opts.preserveNewlines) {
        buf += c;
        i++;
        continue;
      }
      flushBuf();
      out.push({ type: 'line_break' });
      i++;
      continue;
    }

    // Inline code (backtick) — check before other delimiters
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        flushBuf();
        out.push({ type: 'code_inline', value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // @everyone / @here broadcast mentions (plain text, not wrapped in <>).
    // Only match at a word boundary so we don't grab "foo@everyone".
    if (c === '@') {
      const prev = i > 0 ? text[i - 1]! : '';
      const atWordBoundary = i === 0 || /\s|[.,;:!?(\[{<>"']/.test(prev);
      if (atWordBoundary) {
        const broadcastMatch = /^@(everyone|here)\b/.exec(text.slice(i));
        if (broadcastMatch) {
          flushBuf();
          out.push({ type: 'mention_broadcast', name: broadcastMatch[1] as 'everyone' | 'here' });
          i += broadcastMatch[0].length;
          continue;
        }
      }
    }

    // Discord mention / emoji tokens starting with '<'
    if (c === '<') {
      // Custom emoji: <a:name:id> or <:name:id>
      const emojiMatch = /^<(a?):([A-Za-z0-9_]+):(\d+)>/.exec(text.slice(i));
      if (emojiMatch) {
        flushBuf();
        out.push({
          type: 'custom_emoji',
          name: emojiMatch[2]!,
          id: emojiMatch[3]!,
          animated: emojiMatch[1] === 'a',
        });
        i += emojiMatch[0].length;
        continue;
      }
      // Role mention: <@&id>
      const roleMatch = /^<@&(\d+)>/.exec(text.slice(i));
      if (roleMatch) {
        flushBuf();
        out.push({ type: 'mention_role', id: roleMatch[1]! });
        i += roleMatch[0].length;
        continue;
      }
      // User mention: <@id> or <@!id>
      const userMatch = /^<@!?(\d+)>/.exec(text.slice(i));
      if (userMatch) {
        flushBuf();
        out.push({ type: 'mention_user', id: userMatch[1]! });
        i += userMatch[0].length;
        continue;
      }
      // Channel mention: <#id>
      const channelMatch = /^<#(\d+)>/.exec(text.slice(i));
      if (channelMatch) {
        flushBuf();
        out.push({ type: 'mention_channel', id: channelMatch[1]! });
        i += channelMatch[0].length;
        continue;
      }
    }

    // Markdown link: [text](url) — parsed before auto-link so the bracket
    // form wins when it overlaps with a bare URL inside the parens. URL is
    // walked with paren-depth tracking so wiki-style links like
    // `[wiki](https://en.wikipedia.org/wiki/Foo_(bar))` keep both `)`s.
    if (c === '[') {
      const labelEnd = findMatchingBracket(text, i, '[', ']');
      if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const urlStart = labelEnd + 2;
        const urlEnd = findClosingParen(text, urlStart);
        if (urlEnd !== -1) {
          const label = text.slice(i + 1, labelEnd);
          const url = text.slice(urlStart, urlEnd).trim();
          if (url.length > 0) {
            flushBuf();
            out.push({
              type: 'link',
              url,
              children: parseInline(label, opts),
            });
            i = urlEnd + 1;
            continue;
          }
        }
      }
    }

    // Suppressed link: <https://url> — Discord uses these to hide embeds.
    // We render them as a normal link without the angle brackets.
    if (c === '<' && (text.startsWith('<http://', i) || text.startsWith('<https://', i))) {
      const close = text.indexOf('>', i);
      if (close !== -1) {
        const url = text.slice(i + 1, close);
        if (/^https?:\/\/\S+$/.test(url)) {
          flushBuf();
          out.push({ type: 'link', url, children: [{ type: 'text', value: url }] });
          i = close + 1;
          continue;
        }
      }
    }

    // Auto-link bare URLs. Trim trailing punctuation so a sentence-ending
    // period or closing paren doesn't get sucked into the href.
    if (c === 'h' && (text.startsWith('https://', i) || text.startsWith('http://', i))) {
      const m = /^https?:\/\/[^\s<>]+/.exec(text.slice(i));
      if (m) {
        const trimmed = trimTrailingPunctuation(m[0]);
        flushBuf();
        out.push({
          type: 'link',
          url: trimmed,
          children: [{ type: 'text', value: trimmed }],
        });
        i += trimmed.length;
        continue;
      }
    }

    // Inline formatting delimiters — ordered longest-first to avoid
    // single-char delimiters swallowing double-char ones.
    const pairs: Array<{
      open: string;
      close: string;
      type: 'bold' | 'italic' | 'strike' | 'spoiler';
    }> = [
      { open: '**', close: '**', type: 'bold' },
      { open: '__', close: '__', type: 'bold' },
      { open: '~~', close: '~~', type: 'strike' },
      { open: '||', close: '||', type: 'spoiler' },
      { open: '*', close: '*', type: 'italic' },
      { open: '_', close: '_', type: 'italic' },
    ];

    let matched = false;
    for (const p of pairs) {
      if (text.startsWith(p.open, i)) {
        // Find a closing delimiter that is NOT immediately adjacent (must contain content)
        const close = text.indexOf(p.close, i + p.open.length);
        if (close !== -1 && close > i + p.open.length) {
          flushBuf();
          const inner = text.slice(i + p.open.length, close);
          out.push({ type: p.type, children: parseInline(inner, opts) });
          i = close + p.close.length;
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;

    buf += c;
    i++;
  }

  flushBuf();
  return out;
}

// Walks `text` from `start` (the char *after* the opening paren) until a
// matching `)` at depth 0. Tracks nested parens so URLs containing balanced
// parens (Wikipedia, MDN section IDs, etc.) survive intact. Bails on `\n`
// since markdown links don't span line breaks.
function findClosingParen(text: string, start: number): number {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') return -1;
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Walks `text` from `start` (which sits on `open`), respecting nested
// brackets, and returns the index of the matching `close`, or -1.
function findMatchingBracket(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { i++; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Discord trims a small set of trailing punctuation off bare URLs so that
// "see https://example.com." doesn't include the period in the link.
const TRAILING_PUNCT = /[.,;:!?'")\]]+$/;
function trimTrailingPunctuation(url: string): string {
  let trimmed = url.replace(TRAILING_PUNCT, '');
  // Re-balance parens so URLs like https://en.wikipedia.org/wiki/Foo_(bar)
  // keep their final `)` if there was a matching `(` earlier in the URL.
  const opens = (trimmed.match(/\(/g) ?? []).length;
  const closes = (trimmed.match(/\)/g) ?? []).length;
  if (closes < opens && url.length > trimmed.length && url[trimmed.length] === ')') {
    trimmed += ')';
  }
  return trimmed;
}
