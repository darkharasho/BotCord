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
  | { type: 'link'; url: string; children: MdNode[] }
  | { type: 'mention_user'; id: string }
  | { type: 'mention_channel'; id: string }
  | { type: 'mention_role'; id: string }
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

    // Find the next block-level boundary (code fence or blockquote start)
    let nextBlock = input.length;
    const nextCode = input.indexOf('```', i);
    if (nextCode !== -1 && nextCode < nextBlock) nextBlock = nextCode;
    const bq = input.indexOf('\n> ', i);
    if (bq !== -1 && bq + 1 < nextBlock) nextBlock = bq + 1;
    // Handle blockquote at position 0
    if (i === 0 && input.startsWith('> ')) nextBlock = i;

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

    // Auto-link bare URLs
    if (c === 'h' && (text.startsWith('https://', i) || text.startsWith('http://', i))) {
      const m = /^https?:\/\/[^\s<>]+/.exec(text.slice(i));
      if (m) {
        flushBuf();
        out.push({
          type: 'link',
          url: m[0],
          children: [{ type: 'text', value: m[0] }],
        });
        i += m[0].length;
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
