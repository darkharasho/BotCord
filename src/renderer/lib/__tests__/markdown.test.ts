import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../markdown';

describe('parseMarkdown', () => {
  it('parses plain text as a single text token', () => {
    expect(parseMarkdown('hello world')).toEqual([{ type: 'text', value: 'hello world' }]);
  });

  it('parses bold with double-asterisk', () => {
    const out = parseMarkdown('a **bold** b');
    expect(out).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'bold', children: [{ type: 'text', value: 'bold' }] },
      { type: 'text', value: ' b' },
    ]);
  });

  it('parses italic with single underscore', () => {
    const out = parseMarkdown('_em_');
    expect(out).toEqual([{ type: 'italic', children: [{ type: 'text', value: 'em' }] }]);
  });

  it('parses strikethrough with double tilde', () => {
    expect(parseMarkdown('~~gone~~')).toEqual([
      { type: 'strike', children: [{ type: 'text', value: 'gone' }] },
    ]);
  });

  it('parses inline code with single backtick', () => {
    expect(parseMarkdown('use `npm test`')).toEqual([
      { type: 'text', value: 'use ' },
      { type: 'code_inline', value: 'npm test' },
    ]);
  });

  it('parses fenced code blocks with optional language', () => {
    expect(parseMarkdown('```ts\nconst x = 1;\n```')).toEqual([
      { type: 'code_block', lang: 'ts', value: 'const x = 1;' },
    ]);
  });

  it('parses spoilers with double pipe', () => {
    expect(parseMarkdown('||secret||')).toEqual([
      { type: 'spoiler', children: [{ type: 'text', value: 'secret' }] },
    ]);
  });

  it('parses blockquotes (lines starting with > )', () => {
    expect(parseMarkdown('> hi\n> there')).toEqual([
      { type: 'blockquote', children: [{ type: 'text', value: 'hi\nthere' }] },
    ]);
  });

  it('parses user mentions', () => {
    expect(parseMarkdown('hi <@123>')).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'mention_user', id: '123' },
    ]);
  });

  it('parses channel mentions', () => {
    expect(parseMarkdown('see <#456>')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'mention_channel', id: '456' },
    ]);
  });

  it('parses role mentions', () => {
    expect(parseMarkdown('<@&789>')).toEqual([{ type: 'mention_role', id: '789' }]);
  });

  it('parses custom emoji (static and animated)', () => {
    expect(parseMarkdown('<:fire:111>')).toEqual([
      { type: 'custom_emoji', name: 'fire', id: '111', animated: false },
    ]);
    expect(parseMarkdown('<a:dance:222>')).toEqual([
      { type: 'custom_emoji', name: 'dance', id: '222', animated: true },
    ]);
  });

  it('auto-links bare URLs', () => {
    expect(parseMarkdown('see https://example.com end')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'https://example.com' }] },
      { type: 'text', value: ' end' },
    ]);
  });

  it('preserves line breaks as line_break tokens', () => {
    expect(parseMarkdown('a\nb')).toEqual([
      { type: 'text', value: 'a' },
      { type: 'line_break' },
      { type: 'text', value: 'b' },
    ]);
  });

  it('handles mixed inline formatting', () => {
    expect(parseMarkdown('**bold _and italic_**')).toEqual([
      { type: 'bold', children: [
        { type: 'text', value: 'bold ' },
        { type: 'italic', children: [{ type: 'text', value: 'and italic' }] },
      ]},
    ]);
  });

  it('parses [text](url) markdown links', () => {
    expect(parseMarkdown('see [the docs](https://example.com) please')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'the docs' }] },
      { type: 'text', value: ' please' },
    ]);
  });

  it('keeps balanced parens inside markdown link URLs', () => {
    expect(parseMarkdown('[wiki](https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual([
      { type: 'link', url: 'https://en.wikipedia.org/wiki/Foo_(bar)', children: [{ type: 'text', value: 'wiki' }] },
    ]);
  });

  it('parses suppressed-embed links <https://...>', () => {
    expect(parseMarkdown('see <https://example.com> please')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'https://example.com' }] },
      { type: 'text', value: ' please' },
    ]);
  });

  it('trims sentence-ending punctuation off bare URLs', () => {
    expect(parseMarkdown('go to https://example.com.')).toEqual([
      { type: 'text', value: 'go to ' },
      { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'https://example.com' }] },
      { type: 'text', value: '.' },
    ]);
  });
});
