import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { STANDARD_EMOJI, EMOJI_CATEGORIES } from '../lib/emoji-data';
import { toTwemojiUrl } from '../lib/twemoji';
import type { GuildEmoji } from '../../shared/domain';

type Tab = 'standard' | 'server';

// Tailwind classes that control where the picker docks. Positions other than
// the default put the entrance origin somewhere other than bottom-right,
// hence the matching `origin-*` and `animate-*` classes.
const POSITIONS = {
  bottomRight: 'absolute bottom-full right-0 mb-2 origin-bottom-right animate-fade-in-up',
  topRight:    'absolute top-full right-0 mt-2 origin-top-right animate-fade-in-down',
  topLeft:     'absolute top-full left-0 mt-2 origin-top-left animate-fade-in-down',
} as const;
type PickerPosition = keyof typeof POSITIONS;

export function EmojiPicker({
  guildEmojis,
  onSelect,
  onClose,
  position = 'bottomRight',
  anchorRect,
  ignoreRef,
}: {
  guildEmojis: GuildEmoji[];
  onSelect: (token: string) => void;
  onClose: () => void;
  position?: PickerPosition;
  // When provided, the picker renders into a body-level portal, fixed-
  // positioned beneath the supplied rect. Use this when the trigger sits
  // inside a clipping container (modal body, scroll area) where absolute
  // positioning would get cut off.
  anchorRect?: DOMRect | null;
  // Element (typically the trigger button) excluded from the outside-click
  // dismiss — otherwise toggling the trigger to close races with the
  // listener and re-opens the picker.
  ignoreRef?: { current: HTMLElement | null };
}) {
  const [tab, setTab] = useState<Tab>(guildEmojis.length > 0 ? 'server' : 'standard');
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-outside dismiss + Escape. Defer the listener install by one tick
  // so the click that opened us doesn't immediately close it.
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const el = rootRef.current;
      const trigger = ignoreRef?.current;
      const target = e.target as Node;
      if (el && !el.contains(target) && !(trigger && trigger.contains(target))) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', onDocDown);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, ignoreRef]);

  const filteredStd = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return STANDARD_EMOJI;
    return STANDARD_EMOJI.filter(e => e.name.includes(q) || e.keywords.includes(q));
  }, [query]);

  const filteredServer = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return guildEmojis;
    return guildEmojis.filter(e => e.name.toLowerCase().includes(q));
  }, [guildEmojis, query]);

  // Fixed-position mode: portal to body with viewport coords so the picker
  // escapes any clipping ancestor (modal body, scroll area).
  const fixedStyle = anchorRect
    ? (() => {
        const PICKER_W = 320; // w-80
        const PICKER_H = 384; // max-h-96
        const margin = 8;
        // Prefer below the anchor; flip up when there's not enough room.
        const spaceBelow = window.innerHeight - anchorRect.bottom;
        const top = spaceBelow >= PICKER_H + margin
          ? anchorRect.bottom + margin
          : Math.max(margin, anchorRect.top - PICKER_H - margin);
        // Keep the picker on-screen horizontally.
        const left = Math.min(
          Math.max(margin, anchorRect.left),
          window.innerWidth - PICKER_W - margin,
        );
        return { position: 'fixed' as const, top, left };
      })()
    : null;

  const inner = (
    <div
      ref={rootRef}
      className={
        fixedStyle
          ? 'w-80 max-h-96 bg-bg-subtle border border-border rounded-lg shadow-2xl flex flex-col z-50 animate-fade-in-up'
          : `${POSITIONS[position]} w-80 max-h-96 bg-bg-subtle border border-border rounded-lg shadow-2xl flex flex-col z-50`
      }
      style={fixedStyle ?? undefined}
    >
      <div className="flex border-b border-border">
        <button
          className={`flex-1 px-3 py-2 text-xs font-semibold ${tab === 'server' ? 'bg-bg-sunken text-fg' : 'text-fg-muted hover:text-fg'}`}
          onClick={() => setTab('server')}
          disabled={guildEmojis.length === 0}
        >
          Server
        </button>
        <button
          className={`flex-1 px-3 py-2 text-xs font-semibold ${tab === 'standard' ? 'bg-bg-sunken text-fg' : 'text-fg-muted hover:text-fg'}`}
          onClick={() => setTab('standard')}
        >
          Standard
        </button>
        <button className="px-3 py-2 text-xs text-fg-muted hover:text-fg" onClick={onClose}>×</button>
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search…"
        className="m-2 px-2 py-1 bg-bg-sunken border border-border rounded text-xs"
      />
      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'server' ? (
          filteredServer.length === 0
            ? <div className="text-fg-muted text-xs p-3 text-center">No custom emoji</div>
            : (
              <div className="grid grid-cols-8 gap-1">
                {filteredServer.map(e => (
                  <button
                    key={e.id}
                    title={`:${e.name}:`}
                    className="hover:bg-bg-sunken rounded p-1"
                    onClick={() => onSelect(`<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`)}
                  >
                    <img src={e.url} alt={e.name} className="w-7 h-7" />
                  </button>
                ))}
              </div>
            )
        ) : (
          EMOJI_CATEGORIES.map(cat => {
            const items = filteredStd.filter(e => e.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat} className="mb-2">
                <div className="text-[10px] uppercase font-semibold text-fg-muted px-1 mb-1">{cat}</div>
                <div className="grid grid-cols-8 gap-1">
                  {items.map(e => (
                    <button
                      key={e.name}
                      title={`:${e.name}:`}
                      className="hover:bg-bg-sunken rounded p-1 flex items-center justify-center"
                      onClick={() => onSelect(e.char)}
                    >
                      <TwemojiGridImg char={e.char} />
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return fixedStyle ? createPortal(inner, document.body) : inner;
}

// Small grid <img> that falls back to the native glyph if the Twemoji SVG
// is missing — keeps the picker grid free of broken-image icons.
function TwemojiGridImg({ char }: { char: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) return <span className="text-xl leading-none select-none">{char}</span>;
  return (
    <img
      src={toTwemojiUrl(char)}
      alt={char}
      loading="lazy"
      draggable={false}
      className="w-7 h-7 select-none"
      onError={() => setErrored(true)}
    />
  );
}
