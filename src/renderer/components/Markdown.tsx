import type { MdNode } from '../lib/markdown';
import { parseMarkdown } from '../lib/markdown';
import type { ResolvedMention } from '../../shared/domain';
import { useEffect, useState, type ReactNode } from 'react';
import { renderTwemoji } from '../lib/twemoji';
import { api } from '../lib/api';

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
    case 'text': return <span key={key}>{renderTwemoji(n.value, String(key))}</span>;
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
    case 'heading': {
      // Match Discord's heading scale; render as a block via display:block
      // so the heading sits on its own line within the message wrapper.
      const cls = n.level === 1
        ? 'block text-[24px] leading-[1.25] font-bold text-fg mt-4 first:mt-0 mb-1'
        : n.level === 2
        ? 'block text-[20px] leading-[1.25] font-bold text-fg mt-3 first:mt-0 mb-1'
        : 'block text-[16px] leading-[1.25] font-bold text-fg mt-2 first:mt-0 mb-1';
      return (
        <span key={key} className={cls}>
          {n.children.map((c, i) => renderNode(c, i, mentions, jumbo))}
        </span>
      );
    }
    case 'link': {
      // Intercept Discord channel/message links so we navigate inside the app
      // and render them as chips matching how Discord renders these links.
      const dl = parseDiscordLink(n.url);
      if (dl) return <DiscordLinkChip key={key} url={n.url} link={dl} />;
      return (
        <a
          key={key}
          href={n.url}
          title={n.url}
          className="text-link hover:underline break-all"
          onClick={(e) => {
            e.preventDefault();
            window.botcord.system.openExternal(n.url);
          }}
        >
          {n.children.map((c, i) => renderNode(c, i, mentions, jumbo))}
        </a>
      );
    }
    case 'mention_user': {
      const m = mentions.find(x => x.type === 'user' && x.id === n.id);
      return <span key={key} className="bg-[#5865f2]/30 text-[#8593ce] font-medium rounded px-1 hover:bg-[#5865f2]/50 cursor-pointer">@{m?.name ?? n.id}</span>;
    }
    case 'mention_channel': {
      const m = mentions.find(x => x.type === 'channel' && x.id === n.id);
      const cid = n.id;
      return (
        <span
          key={key}
          className="bg-[#5865f2]/30 text-[#8593ce] font-medium rounded px-1 hover:bg-[#5865f2]/50 cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('botcord:open-channel', {
              detail: { channelId: cid },
            }));
          }}
        >#{m?.name ?? n.id}</span>
      );
    }
    case 'mention_role': {
      const m = mentions.find(x => x.type === 'role' && x.id === n.id);
      return <span key={key} className="bg-[#5865f2]/30 text-[#8593ce] font-medium rounded px-1 hover:bg-[#5865f2]/50 cursor-pointer">@{m?.name ?? n.id}</span>;
    }
    case 'mention_broadcast':
      return <span key={key} className="bg-[#5865f2]/30 text-[#8593ce] font-medium rounded px-1 hover:bg-[#5865f2]/50 cursor-pointer">@{n.name}</span>;
    case 'custom_emoji':
      return <CustomEmoji key={key} id={n.id} name={n.name} animated={n.animated} jumbo={jumbo} />;
  }
}

// Themed hover preview for custom guild emojis. Mirrors the reaction-pill
// look + the poll-vote tooltip pattern: cursor-anchored, fixed-positioned
// chip floating above the mouse with the emoji preview and its `:name:`.
function CustomEmoji({ id, name, animated, jumbo }: { id: string; name: string; animated: boolean; jumbo: boolean }) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const ext = animated ? 'gif' : 'png';
  const url = `https://cdn.discordapp.com/emojis/${id}.${ext}`;
  const style = jumbo
    ? { width: '48px', height: '48px' }
    : { width: '1.375em', height: '1.375em' };
  return (
    <>
      <img
        src={url}
        alt={`:${name}:`}
        className="inline-block align-text-bottom"
        style={style}
        onMouseMove={(e) => setCursor({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setCursor(null)}
        onError={(e) => { (e.currentTarget as HTMLImageElement).replaceWith(document.createTextNode(`:${name}:`)); }}
      />
      {cursor && (
        <span
          className="fixed z-50 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-sunken border border-white/[0.08] shadow-xl text-[12px] text-fg pointer-events-none animate-fade-in whitespace-nowrap"
          style={{
            left: cursor.x,
            top: cursor.y - 12,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <img src={url} alt="" className="w-5 h-5" />
          <span className="text-fg-muted">:{name}:</span>
        </span>
      )}
    </>
  );
}

// Matches https://discord.com/channels/<guildId>/<channelId>[/<messageId>]
// and equivalent on canary/ptb. Returns null if the URL isn't a discord link.
function parseDiscordLink(url: string): { guildId: string; channelId: string; messageId?: string } | null {
  try {
    const u = new URL(url);
    if (!/^(?:.+\.)?discord\.com$/i.test(u.hostname) && !/^discordapp\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/channels\/(\d+)\/(\d+)(?:\/(\d+))?\/?$/);
    if (!m) return null;
    const out: { guildId: string; channelId: string; messageId?: string } = { guildId: m[1]!, channelId: m[2]! };
    if (m[3]) out.messageId = m[3];
    return out;
  } catch { return null; }
}

// Module-level cache so repeated chips for the same channel render synchronously
// after the first lookup (no flash, no repeat IPCs).
const channelNameCache = new Map<string, string>();

function DiscordLinkChip({ url, link }: { url: string; link: { guildId: string; channelId: string; messageId?: string } }) {
  const cached = channelNameCache.get(link.channelId) ?? null;
  const [name, setName] = useState<string | null>(cached);

  useEffect(() => {
    if (name) return;
    let cancelled = false;
    api.guilds.listChannels(link.guildId).then(res => {
      if (cancelled || !res.ok) return;
      const ch = res.data.find(c => c.id === link.channelId);
      if (ch) {
        channelNameCache.set(link.channelId, ch.name);
        setName(ch.name);
      }
    });
    return () => { cancelled = true; };
  }, [link.channelId, link.guildId, name]);

  return (
    <span
      title={url}
      onClick={(e) => {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('botcord:open-channel', {
          detail: { guildId: link.guildId, channelId: link.channelId, messageId: link.messageId },
        }));
      }}
      className="bg-[#5865f2]/30 text-[#8593ce] font-medium rounded px-1 hover:bg-[#5865f2]/50 cursor-pointer"
    >
      {link.messageId ? '↗ ' : ''}#{name ?? '…'}
    </span>
  );
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
