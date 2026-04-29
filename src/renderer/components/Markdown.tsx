import type { MdNode } from '../lib/markdown';
import { parseMarkdown } from '../lib/markdown';
import type { ResolvedMention } from '../../shared/domain';
import { useState, type ReactNode } from 'react';

type Props = {
  source: string;
  mentions?: ResolvedMention[];
  jumbo?: boolean;
};

const EMOJI_ONLY_RE = /^[\s‍️\p{Extended_Pictographic}\p{Emoji_Component}]*$/u;
const EMOJI_GLYPH_RE = /\p{Extended_Pictographic}/gu;

/**
 * True when the message renders as nothing but emoji + whitespace and the
 * total emoji count is small enough to be visually pleasant when enlarged.
 */
export function isEmojiOnly(tree: MdNode[]): boolean {
  let emojiCount = 0;
  for (const n of tree) {
    if (n.type === 'custom_emoji') { emojiCount += 1; continue; }
    if (n.type === 'line_break') continue;
    if (n.type === 'text') {
      if (n.value.trim().length === 0) continue;
      if (!EMOJI_ONLY_RE.test(n.value)) return false;
      emojiCount += (n.value.match(EMOJI_GLYPH_RE) ?? []).length;
      continue;
    }
    return false;
  }
  return emojiCount > 0 && emojiCount <= 30;
}

export function Markdown({ source, mentions = [], jumbo: jumboProp }: Props) {
  const tree = parseMarkdown(source);
  const jumbo = jumboProp ?? isEmojiOnly(tree);
  return (
    <span className={jumbo ? 'text-[40px] leading-[1.2]' : undefined}>
      {tree.map((n, i) => renderNode(n, i, mentions, jumbo))}
    </span>
  );
}

function renderNode(n: MdNode, key: number, mentions: ResolvedMention[], jumbo: boolean): ReactNode {
  switch (n.type) {
    case 'text': return <span key={key}>{n.value}</span>;
    case 'line_break': return <br key={key} />;
    case 'bold': return <strong key={key}>{n.children.map((c, i) => renderNode(c, i, mentions, jumbo))}</strong>;
    case 'italic': return <em key={key}>{n.children.map((c, i) => renderNode(c, i, mentions, jumbo))}</em>;
    case 'strike': return <s key={key}>{n.children.map((c, i) => renderNode(c, i, mentions, jumbo))}</s>;
    case 'spoiler': return <Spoiler key={key}>{n.children.map((c, i) => renderNode(c, i, mentions, jumbo))}</Spoiler>;
    case 'code_inline':
      return <code key={key} className="bg-bg-sunken px-1 py-0.5 rounded text-xs font-mono">{n.value}</code>;
    case 'code_block':
      return (
        <pre key={key} className="bg-bg-sunken border border-border rounded p-3 my-1 overflow-x-auto text-xs font-mono">
          <code>{n.value}</code>
        </pre>
      );
    case 'blockquote':
      return (
        <blockquote key={key} className="border-l-4 border-border pl-3 my-1">
          {n.children.map((c, i) => renderNode(c, i, mentions, jumbo))}
        </blockquote>
      );
    case 'link':
      return (
        <a key={key} href={n.url} className="text-accent hover:underline" onClick={(e) => {
          e.preventDefault();
          window.botcord.system.openExternal(n.url);
        }}>
          {n.children.map((c, i) => renderNode(c, i, mentions, jumbo))}
        </a>
      );
    case 'mention_user': {
      const m = mentions.find(x => x.type === 'user' && x.id === n.id);
      return <span key={key} className="bg-accent/30 text-[#8593ce] font-medium rounded px-1 hover:bg-accent/50 cursor-pointer">@{m?.name ?? n.id}</span>;
    }
    case 'mention_channel': {
      const m = mentions.find(x => x.type === 'channel' && x.id === n.id);
      return <span key={key} className="bg-accent/30 text-[#8593ce] font-medium rounded px-1 hover:bg-accent/50 cursor-pointer">#{m?.name ?? n.id}</span>;
    }
    case 'mention_role': {
      const m = mentions.find(x => x.type === 'role' && x.id === n.id);
      return <span key={key} className="bg-accent/30 text-[#8593ce] font-medium rounded px-1 hover:bg-accent/50 cursor-pointer">@{m?.name ?? n.id}</span>;
    }
    case 'custom_emoji': {
      const ext = n.animated ? 'gif' : 'png';
      const sizeCls = jumbo ? 'w-12 h-12' : 'w-5 h-5';
      return (
        <img
          key={key}
          src={`https://cdn.discordapp.com/emojis/${n.id}.${ext}`}
          alt={`:${n.name}:`}
          title={`:${n.name}:`}
          className={`inline-block align-text-bottom ${sizeCls}`}
          onError={(e) => { (e.currentTarget as HTMLImageElement).replaceWith(document.createTextNode(`:${n.name}:`)); }}
        />
      );
    }
  }
}

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => setRevealed(true)}
      className={`rounded px-1 cursor-pointer ${revealed ? 'bg-bg-sunken' : 'bg-fg text-bg select-none'}`}
    >
      {children}
    </span>
  );
}
