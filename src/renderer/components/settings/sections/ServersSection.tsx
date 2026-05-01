import { useEffect, useMemo, useState } from 'react';
import { IconSearch, IconChevronRight, IconUsers } from '@tabler/icons-react';
import { api } from '../../../lib/api';
import type { GuildSummary } from '../../../../shared/domain';
import { AutonomySettingsTab } from '../../AutonomySettingsTab';
import { SectionHeader } from './AccountSection';

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
      <div className="max-w-3xl space-y-6 animate-fade-in">
        <button
          onClick={() => setSelected(null)}
          aria-label="Back to servers"
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted hover:text-fg transition-colors"
        >
          ← Servers
        </button>
        <div className="flex items-center gap-4">
          {selected.iconUrl
            ? <img src={selected.iconUrl} alt="" className="w-14 h-14 rounded-2xl ring-2 ring-border" />
            : <div className="w-14 h-14 rounded-2xl bg-bg-input border border-border flex items-center justify-center text-base font-semibold text-fg">{selected.name.slice(0, 2).toUpperCase()}</div>
          }
          <div className="min-w-0">
            <h2 className="text-2xl font-bold text-fg tracking-tight truncate">{selected.name}</h2>
            {selected.memberCount !== null && (
              <div className="flex items-center gap-1 text-xs text-fg-muted mt-0.5">
                <IconUsers size={12} stroke={2} />
                {selected.memberCount.toLocaleString()} members
              </div>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-bg-input p-5">
          <AutonomySettingsTab guildId={selected.id} />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <SectionHeader title="Servers" subtitle="Per-server autonomy overrides. Pick a server to configure it." />

      <div className="rounded-xl border border-border bg-bg-input overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border flex items-center gap-2 bg-bg-sunken/40">
          <IconSearch size={14} stroke={2} className="text-fg-dim shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search servers"
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-dim min-w-0"
          />
          {guilds.length > 0 && (
            <span className="text-[10px] uppercase tracking-[0.14em] text-fg-dim font-semibold">
              {filtered.length}
              {filtered.length !== guilds.length && ` / ${guilds.length}`}
            </span>
          )}
        </div>
        <div className="max-h-[28rem] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-xs text-fg-muted text-center">
              {guilds.length === 0 ? 'No servers connected.' : `No servers match "${query}".`}
            </div>
          )}
          {filtered.map(g => (
            <button
              key={g.id}
              onClick={() => setSelected(g)}
              className="group w-full flex items-center gap-3 px-3 py-2.5 hover:bg-hover text-left border-b border-border last:border-b-0 transition-colors"
            >
              {g.iconUrl
                ? <img src={g.iconUrl} alt="" className="w-9 h-9 rounded-xl ring-1 ring-border group-hover:ring-accent/40 transition-shadow" />
                : <div className="w-9 h-9 rounded-xl bg-bg border border-border flex items-center justify-center text-xs font-semibold text-fg group-hover:border-accent/40 transition-colors">{g.name.slice(0, 2).toUpperCase()}</div>
              }
              <div className="flex-1 min-w-0">
                <div className="text-sm text-fg truncate font-medium">{g.name}</div>
                {g.memberCount !== null && (
                  <div className="text-[11px] text-fg-muted">{g.memberCount.toLocaleString()} members</div>
                )}
              </div>
              <IconChevronRight size={14} className="text-fg-dim group-hover:text-fg-muted group-hover:translate-x-0.5 shrink-0 transition-all" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
