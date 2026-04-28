import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { GuildSummary } from '../../shared/domain';

export function GuildList({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await api.guilds.list();
      if (!active) return;
      if (res.ok) { setGuilds(res.data); setError(null); }
      else setError(res.error.message);
    };
    load();
    const unsub = api.events.onGuildUpdate(() => load());
    const unsubGw = api.events.onGatewayState((s) => { if (s.status === 'ready') load(); });
    return () => { active = false; unsub(); unsubGw(); };
  }, []);

  return (
    <div className="h-full overflow-y-auto p-2 space-y-1">
      {error && <div className="text-danger text-xs px-2 py-1">{error}</div>}
      {guilds.map(g => (
        <button
          key={g.id}
          onClick={() => onSelect(g.id)}
          className={`w-full flex items-center gap-2 px-2 py-2 rounded text-left text-sm
            ${selected === g.id ? 'bg-bg-subtle' : 'hover:bg-bg-subtle/50'}`}
        >
          {g.iconUrl
            ? <img src={g.iconUrl} alt="" className="w-7 h-7 rounded-full" />
            : <div className="w-7 h-7 rounded-full bg-border flex items-center justify-center text-xs">
                {g.name.slice(0, 2).toUpperCase()}
              </div>}
          <span className="truncate">{g.name}</span>
        </button>
      ))}
      {guilds.length === 0 && !error && (
        <div className="text-fg-muted text-xs px-2 py-1">No guilds. Invite the bot to a server.</div>
      )}
    </div>
  );
}
