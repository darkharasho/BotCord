import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { pushToast } from './Toaster';
import { MembersToolbar } from './members/MembersToolbar';
import { MembersTable, type SortKey } from './members/MembersTable';
import { MembersBulkBar } from './members/MembersBulkBar';
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

  // Per-column filter state
  const [memberSinceFrom, setMemberSinceFrom] = useState<number | null>(null);
  const [memberSinceTo, setMemberSinceTo] = useState<number | null>(null);
  const [createdAtFrom, setCreatedAtFrom] = useState<number | null>(null);
  const [createdAtTo, setCreatedAtTo] = useState<number | null>(null);
  const [roleFilters, setRoleFilters] = useState<Set<string>>(new Set());

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
    // Reset per-column filters on guild switch
    setMemberSinceFrom(null);
    setMemberSinceTo(null);
    setCreatedAtFrom(null);
    setCreatedAtTo(null);
    setRoleFilters(new Set());

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
    if (roleFilters.size > 0) {
      rows = rows.filter(e => Array.from(roleFilters).every(rid => e.roleIds.includes(rid)));
    }
    if (memberSinceFrom != null) rows = rows.filter(e => (e.joinedAt ?? 0) >= memberSinceFrom);
    if (memberSinceTo != null) rows = rows.filter(e => (e.joinedAt ?? Infinity) <= memberSinceTo);
    if (createdAtFrom != null) rows = rows.filter(e => e.createdAt >= createdAtFrom);
    if (createdAtTo != null) rows = rows.filter(e => e.createdAt <= createdAtTo);
    const dir = sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (sortKey === 'name') return dir * a.displayName.localeCompare(b.displayName);
      if (sortKey === 'joinedAt') return dir * ((a.joinedAt ?? 0) - (b.joinedAt ?? 0));
      return dir * (a.createdAt - b.createdAt);
    });
    return rows;
  }, [entries, search, roleFilter, roleFilters, memberSinceFrom, memberSinceTo, createdAtFrom, createdAtTo, sortKey, sortDir]);

  const rolesById = useMemo(() => {
    const m = new Map<string, GuildRole>();
    for (const r of roles) m.set(r.id, r);
    return m;
  }, [roles]);

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
      <MembersToolbar
        search={search}
        onSearch={setSearch}
        roles={roles}
        roleFilter={roleFilter}
        onRoleFilter={setRoleFilter}
        totalCount={entries.length}
        filteredCount={filtered.length}
        intentMissing={intentMissing}
      />
      {loading && entries.length === 0 && (
        <div className="px-4 py-2 text-fg-dim text-[12px]">Loading members…</div>
      )}
      <MembersTable
        guildId={guildId}
        rows={filtered}
        selected={selected}
        onToggleSelected={(id) => setSelected(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        })}
        onToggleAllFiltered={() => setSelected(prev => {
          const allChecked = filtered.length > 0 && filtered.every(r => prev.has(r.id));
          if (allChecked) {
            const next = new Set(prev);
            for (const r of filtered) next.delete(r.id);
            return next;
          }
          const next = new Set(prev);
          for (const r of filtered) next.add(r.id);
          return next;
        })}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(k: SortKey) => {
          if (k === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
          else { setSortKey(k); setSortDir('desc'); }
        }}
        rolesById={rolesById}
        roles={roles}
        memberSinceFrom={memberSinceFrom}
        memberSinceTo={memberSinceTo}
        onMemberSinceFrom={setMemberSinceFrom}
        onMemberSinceTo={setMemberSinceTo}
        createdAtFrom={createdAtFrom}
        createdAtTo={createdAtTo}
        onCreatedAtFrom={setCreatedAtFrom}
        onCreatedAtTo={setCreatedAtTo}
        roleFilters={roleFilters}
        onRoleFiltersToggle={(roleId) => setRoleFilters(prev => {
          const next = new Set(prev);
          if (next.has(roleId)) next.delete(roleId); else next.add(roleId);
          return next;
        })}
        onRoleFiltersClear={() => setRoleFilters(new Set())}
      />
      <MembersBulkBar
        guildId={guildId}
        selectedIds={Array.from(selected).filter(id => {
          const e = entries.find(en => en.id === id);
          return e ? !e.isBot : false;
        })}
        roles={roles}
        onClear={() => setSelected(new Set())}
        onActionComplete={() => {
          setSelected(new Set());
          // Refresh cached members so role changes / kicks / bans are reflected.
          cache.current.delete(guildId);
          api.guilds.listAllMembers(guildId).then(res => {
            if (res.ok) {
              cache.current.set(guildId, res.data);
              setEntries(res.data.entries);
              setIntentMissing(res.data.intentMissing);
            }
          });
        }}
      />
    </main>
  );
}
