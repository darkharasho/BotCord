import type { MdNode } from '../lib/markdown';
import { parseMarkdown } from '../lib/markdown';
import type { ResolvedMention } from '../../shared/domain';
import { useState, type ReactNode } from 'react';

type Props = {
  source: string;
  mentions?: ResolvedMention[];
};

export function Markdown({ source, mentions = [] }: Props) {
  const tree = parseMarkdown(source);
  return <span>{tree.map((n, i) => renderNode(n, i, mentions))}</span>;
}

function renderNode(n: MdNode, key: number, mentions: ResolvedMention[]): ReactNode {
  switch (n.type) {
    case 'text': return <span key={key}>{n.value}</span>;
    case 'line_break': return <br key={key} />;
    case 'bold': return <strong key={key}>{n.children.map((c, i) => renderNode(c, i, mentions))}</strong>;
    case 'italic': return <em key={key}>{n.children.map((c, i) => renderNode(c, i, mentions))}</em>;
    case 'strike': return <s key={key}>{n.children.map((c, i) => renderNode(c, i, mentions))}</s>;
    case 'spoiler': return <Spoiler key={key}>{n.children.map((c, i) => renderNode(c, i, mentions))}</Spoiler>;
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
          {n.children.map((c, i) => renderNode(c, i, mentions))}
        </blockquote>
      );
    case 'link':
      return (
        <a key={key} href={n.url} className="text-accent hover:underline" onClick={(e) => {
          e.preventDefault();
          window.botcord.system.openExternal(n.url);
        }}>
          {n.children.map((c, i) => renderNode(c, i, mentions))}
        </a>
      );
    case 'mention_user': {
      const m = mentions.find(x => x.type === 'user' && x.id === n.id);
      return <span key={key} className="bg-accent/20 text-accent rounded px-1">@{m?.name ?? n.id}</span>;
    }
    case 'mention_channel': {
      const m = mentions.find(x => x.type === 'channel' && x.id === n.id);
      return <span key={key} className="bg-accent/20 text-accent rounded px-1">#{m?.name ?? n.id}</span>;
    }
    case 'mention_role': {
      const m = mentions.find(x => x.type === 'role' && x.id === n.id);
      return <span key={key} className="bg-accent/20 text-accent rounded px-1">@{m?.name ?? n.id}</span>;
    }
    case 'custom_emoji': {
      const ext = n.animated ? 'gif' : 'png';
      return (
        <img
          key={key}
          src={`https://cdn.discordapp.com/emojis/${n.id}.${ext}`}
          alt={`:${n.name}:`}
          title={`:${n.name}:`}
          className="inline-block w-5 h-5 align-text-bottom"
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
