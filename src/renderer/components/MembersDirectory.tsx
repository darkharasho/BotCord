import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { pushToast } from './Toaster';
import type { AllMembersEntry, GuildRole } from '../../shared/domain';

export function MembersDirectory({ guildId }: { guildId: string | null }) {
  const [entries, setEntries] = useState<AllMembersEntry[]>([]);
  const [intentMissing, setIntentMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState<GuildRole[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'name' | 'joinedAt' | 'createdAt'>('joinedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const cache = useRef<Map<string, { entries: AllMembersEntry[]; intentMissing: boolean }>>(new Map());

  useEffect(() => {
    if (!guildId) { setEntries([]); setRoles([]); setSelected(new Set()); return; }
    let active = true;

    const cached = cache.current.get(guildId);
    if (cached) {
      setEntries(cached.entries);
      setIntentMissing(cached.intentMissing);
    } else {
      setLoading(true);
      setEntries([]);
      setIntentMissing(false);
      api.guilds.listAllMembers(guildId)
        .then(res => {
          if (!active) return;
          setLoading(false);
          if (res.ok) {
            cache.current.set(guildId, res.data);
            setEntries(res.data.entries);
            setIntentMissing(res.data.intentMissing);
          } else {
            pushToast('danger', res.error.message);
          }
        })
        .catch(e => {
          if (!active) return;
          setLoading(false);
          pushToast('danger', e instanceof Error ? e.message : 'Failed to load members');
        });
    }

    setRoles([]);
    api.guilds.listGuildRoles(guildId).then(res => {
      if (!active) return;
      if (res.ok) setRoles(res.data);
    });

    setSelected(new Set());
    setSearch('');
    setRoleFilter(null);

    return () => { active = false; };
  }, [guildId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = entries;
    if (q) {
      rows = rows.filter(e =>
        e.displayName.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q),
      );
    }
    if (roleFilter) {
      rows = rows.filter(e => e.roleIds.includes(roleFilter));
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (sortKey === 'name') return dir * a.displayName.localeCompare(b.displayName);
      if (sortKey === 'joinedAt') return dir * ((a.joinedAt ?? 0) - (b.joinedAt ?? 0));
      return dir * (a.createdAt - b.createdAt);
    });
    return rows;
  }, [entries, search, roleFilter, sortKey, sortDir]);

  if (!guildId) {
    return (
      <main className="flex-1 min-h-0 bg-bg-sunken text-fg-dim flex items-center justify-center border-t border-l border-white/[0.04]">
        Select a server to view its members.
      </main>
    );
  }

  return (
    <main className="flex-1 min-h-0 bg-bg-sunken text-fg flex flex-col border-t border-l border-white/[0.04]">
      {intentMissing && (
        <div className="px-4 py-2 bg-warn/10 border-b border-warn/30 text-warn text-[12px]">
          Bot lacks the privileged Server Members Intent — directory shows cached members only. Enable it in the Discord Developer Portal for the full list.
        </div>
      )}
      <div className="px-4 py-3 border-b border-white/[0.04] text-fg-dim text-[13px]">
        {loading ? 'Loading members…' : `${filtered.length} members`}
        {search || roleFilter ? ` (filtered from ${entries.length})` : ''}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ul className="p-4 space-y-1 text-[13px]">
          {filtered.slice(0, 50).map(e => (
            <li key={e.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.has(e.id)}
                onChange={() => setSelected(prev => {
                  const next = new Set(prev);
                  if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
                  return next;
                })}
              />
              <span style={e.roleColor ? { color: e.roleColor } : undefined}>{e.displayName}</span>
              <span className="text-fg-dim">@{e.username}</span>
            </li>
          ))}
          {filtered.length > 50 && <li className="text-fg-dim">…and {filtered.length - 50} more (table coming in Task 10)</li>}
        </ul>
      </div>
      {selected.size > 0 && (
        <div className="px-4 py-3 border-t border-white/[0.04] text-fg-dim text-[12px]">
          {selected.size} selected (bulk bar coming in Task 13)
        </div>
      )}
      <span className="hidden">{roles.length} roles cached</span>
      <span className="hidden">{[setRoleFilter, setSortKey, setSortDir].length}</span>
    </main>
  );
}
