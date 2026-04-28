import { useState, useMemo } from 'react';
import { STANDARD_EMOJI, EMOJI_CATEGORIES } from '../lib/emoji-data';
import type { GuildEmoji } from '../../shared/domain';

type Tab = 'standard' | 'server';

export function EmojiPicker({
  guildEmojis,
  onSelect,
  onClose,
}: {
  guildEmojis: GuildEmoji[];
  onSelect: (token: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(guildEmojis.length > 0 ? 'server' : 'standard');
  const [query, setQuery] = useState('');

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

  return (
    <div className="absolute bottom-full right-0 mb-2 w-80 max-h-96 bg-bg-subtle border border-border rounded-lg shadow-2xl flex flex-col z-50">
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
                      className="hover:bg-bg-sunken rounded p-1 text-xl"
                      onClick={() => onSelect(e.char)}
                    >
                      {e.char}
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
}
