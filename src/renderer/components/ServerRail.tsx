import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { GuildSummary } from '../../shared/domain';
import { Tooltip } from './Tooltip';

export function ServerRail({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
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
    <div className="h-full overflow-y-auto py-3 flex flex-col items-center gap-2 bg-bg-sunken">
      {error && <div className="text-danger text-xs px-2 text-center">{error}</div>}
      {guilds.map(g => (
        <Tooltip key={g.id} label={g.name} side="right">
          <button
            onClick={() => onSelect(g.id)}
            className="relative group"
          >
            {selected === g.id && (
              <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-10 bg-fg rounded-r" />
            )}
            <div className={`w-12 h-12 overflow-hidden bg-border flex items-center justify-center text-sm font-semibold transition-all duration-150
              ${selected === g.id ? 'rounded-2xl' : 'rounded-3xl group-hover:rounded-2xl'}`}>
              {g.iconUrl
                ? <img src={g.iconUrl} alt="" className="w-full h-full object-cover" />
                : g.name.slice(0, 2).toUpperCase()}
            </div>
          </button>
        </Tooltip>
      ))}
      {guilds.length === 0 && !error && (
        <div className="text-fg-muted text-xs px-2 text-center">No guilds</div>
      )}
    </div>
  );
}
