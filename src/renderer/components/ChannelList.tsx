import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ChannelSummary } from '../../shared/domain';

export function ChannelList({ guildId, selected, onSelect }: { guildId: string | null; selected: string | null; onSelect: (id: string) => void }) {
  const [channels, setChannels] = useState<ChannelSummary[]>([]);

  useEffect(() => {
    if (!guildId) { setChannels([]); return; }
    let active = true;
    const load = async () => {
      const res = await api.guilds.listChannels(guildId);
      if (!active) return;
      if (res.ok) setChannels(res.data);
    };
    load();
    const unsub = api.events.onChannelUpdate((c) => { if (c.guildId === guildId) load(); });
    return () => { active = false; unsub(); };
  }, [guildId]);

  if (!guildId) return <div className="p-3 text-fg-muted text-sm">Select a server.</div>;

  const sorted = [...channels].sort((a, b) => a.position - b.position);

  return (
    <div className="h-full overflow-y-auto p-2 space-y-0.5">
      {sorted.map(c => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm
            ${selected === c.id ? 'bg-bg-subtle' : 'hover:bg-bg-subtle/50'}`}
        >
          <span className="text-fg-muted text-xs w-4 inline-block">{kindGlyph(c.type)}</span>
          <span className="truncate">{c.name}</span>
        </button>
      ))}
    </div>
  );
}

function kindGlyph(t: ChannelSummary['type']): string {
  switch (t) {
    case 'text': return '#';
    case 'announcement': return '📢';
    case 'voice': return '🔊';
    case 'thread': return '↳';
    case 'category': return '▾';
    case 'forum': return '☰';
    default: return '·';
  }
}
