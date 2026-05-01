import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import type { GuildSummary } from '../../../../shared/domain';
import { AutonomySettingsTab } from '../../AutonomySettingsTab';
import { IconSearch, IconChevronRight } from '@tabler/icons-react';

export function ServersSection() {
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [selected, setSelected] = useState<GuildSummary | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await api.guilds.list();
      if (!active) return;
      if (res.ok) setGuilds(res.data);
    };
    load();
    const unsub = api.events.onGuildUpdate(() => load());
    return () => { active = false; unsub(); };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return guilds;
    return guilds.filter(g => g.name.toLowerCase().includes(q));
  }, [guilds, query]);

  if (selected) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelected(null)}
          className="text-sm text-fg-muted hover:text-fg"
        >
          ← Servers / <span className="text-fg">{selected.name}</span>
        </button>
        <h2 className="text-xl font-semibold text-fg">{selected.name}</h2>
        <AutonomySettingsTab guildId={selected.id} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-fg">Servers</h2>
      <p className="text-sm text-fg-muted">Configure per-server autonomy settings.</p>

      <div className="rounded border border-border bg-bg-sunken">
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <IconSearch size={14} stroke={2} className="text-fg-dim shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search servers"
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-dim min-w-0"
          />
        </div>
        <div className="max-h-[28rem] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-xs text-fg-muted text-center">
              {guilds.length === 0 ? 'No servers' : `No servers match "${query}"`}
            </div>
          )}
          {filtered.map(g => (
            <button
              key={g.id}
              onClick={() => setSelected(g)}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-hover text-left border-b border-border last:border-b-0"
            >
              {g.iconUrl
                ? <img src={g.iconUrl} alt="" className="w-8 h-8 rounded-full" />
                : <div className="w-8 h-8 rounded-full bg-bg-subtle flex items-center justify-center text-xs font-semibold text-fg">{g.name.slice(0, 2).toUpperCase()}</div>
              }
              <div className="flex-1 min-w-0">
                <div className="text-sm text-fg truncate">{g.name}</div>
                {g.memberCount !== null && (
                  <div className="text-[11px] text-fg-muted">{g.memberCount.toLocaleString()} members</div>
                )}
              </div>
              <IconChevronRight size={14} className="text-fg-muted shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
