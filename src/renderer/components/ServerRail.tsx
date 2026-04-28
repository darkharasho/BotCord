import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { GuildSummary } from '../../shared/domain';
import { Tooltip } from './Tooltip';

export function ServerRail({ selected, onSelect }: { selected: string | null; onSelect: (g: GuildSummary) => void }) {
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
    <div className="h-full overflow-y-auto pt-3 pb-3 flex flex-col items-center gap-2 bg-bg-sunken">
      {error && <div className="text-danger text-[10px] px-1 text-center leading-tight">{error}</div>}
      {guilds.map(g => (
        <Tooltip key={g.id} label={g.name} side="right">
          <button
            onClick={() => onSelect(g)}
            className="relative group"
          >
            <span
              className={`absolute -left-3 top-1/2 -translate-y-1/2 w-1 bg-fg rounded-r transition-all duration-150
                ${selected === g.id ? 'h-10 opacity-100' : 'h-2 opacity-0 group-hover:h-5 group-hover:opacity-100'}`}
            />
            <div className={`w-12 h-12 overflow-hidden bg-bg-subtle flex items-center justify-center text-sm font-semibold text-fg transition-all duration-150
              group-hover:bg-accent group-hover:text-white
              ${selected === g.id ? 'rounded-2xl bg-accent text-white' : 'rounded-3xl group-hover:rounded-2xl'}`}>
              {g.iconUrl
                ? <img src={g.iconUrl} alt="" className="w-full h-full object-cover" />
                : g.name.slice(0, 2).toUpperCase()}
            </div>
          </button>
        </Tooltip>
      ))}
      {guilds.length === 0 && !error && (
        <div className="text-fg-dim text-[10px] px-1 text-center">No guilds</div>
      )}
    </div>
  );
}
