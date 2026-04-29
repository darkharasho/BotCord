import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { ChannelMemberSummary, PresenceStatus } from '../../shared/domain';

const STATUS_COLOR: Record<PresenceStatus, string> = {
  online: 'bg-ok',
  idle: 'bg-warn',
  dnd: 'bg-danger',
  offline: 'bg-fg-dim',
};

export function MemberList({ guildId, channelId }: { guildId: string | null; channelId: string | null }) {
  const [members, setMembers] = useState<ChannelMemberSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!guildId || !channelId) { setMembers([]); return; }
    let active = true;
    setLoading(true);
    api.guilds.listChannelMembers(guildId, channelId).then(res => {
      if (!active) return;
      setLoading(false);
      if (res.ok) setMembers(res.data);
    });
    return () => { active = false; };
  }, [guildId, channelId]);

  // Group online by hoisted role, offline at the bottom.
  const groups = useMemo(() => {
    const byRole = new Map<string, { name: string; position: number; color: string | null; members: ChannelMemberSummary[] }>();
    const offline: ChannelMemberSummary[] = [];
    const onlineNoRole: ChannelMemberSummary[] = [];

    for (const m of members) {
      if (m.status === 'offline') { offline.push(m); continue; }
      if (!m.topRole) { onlineNoRole.push(m); continue; }
      const key = m.topRole.id;
      let g = byRole.get(key);
      if (!g) {
        g = { name: m.topRole.name, position: m.topRole.position, color: m.topRole.color, members: [] };
        byRole.set(key, g);
      }
      g.members.push(m);
    }

    const sorted = Array.from(byRole.values())
      .sort((a, b) => b.position - a.position)
      .map(g => ({ ...g, members: g.members.sort((a, b) => a.displayName.localeCompare(b.displayName)) }));

    onlineNoRole.sort((a, b) => a.displayName.localeCompare(b.displayName));
    offline.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return { sorted, onlineNoRole, offline };
  }, [members]);

  return (
    <aside className="w-[270px] shrink-0 bg-bg border-t border-l border-white/[0.04] overflow-y-auto py-4">
      {loading && members.length === 0 && (
        <div className="px-4 text-fg-dim text-xs">Loading…</div>
      )}
      {groups.sorted.map(g => (
        <Section key={g.name} title={`${g.name} — ${g.members.length}`} members={g.members} />
      ))}
      {groups.onlineNoRole.length > 0 && (
        <Section title={`Online — ${groups.onlineNoRole.length}`} members={groups.onlineNoRole} />
      )}
      {groups.offline.length > 0 && (
        <Section title={`Offline — ${groups.offline.length}`} members={groups.offline} />
      )}
    </aside>
  );
}

function Section({ title, members }: { title: string; members: ChannelMemberSummary[] }) {
  return (
    <div className="mb-4">
      <div className="px-4 text-[11px] font-semibold uppercase tracking-wide text-fg-dim mb-1">{title}</div>
      <div>
        {members.map(m => <MemberRow key={m.id} member={m} />)}
      </div>
    </div>
  );
}

function MemberRow({ member }: { member: ChannelMemberSummary }) {
  const dim = member.status === 'offline';
  return (
    <div
      className={`flex items-center gap-2 px-2 mx-2 py-1 rounded hover:bg-hover ${dim ? 'opacity-40' : ''}`}
      title={`@${member.username}${member.topRole ? ` · ${member.topRole.name}` : ''}`}
    >
      <div className="relative shrink-0">
        {member.avatarUrl
          ? <img src={member.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
          : <div className="w-8 h-8 rounded-full bg-bg-input flex items-center justify-center text-[10px] font-semibold">{member.displayName.slice(0, 2).toUpperCase()}</div>}
        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ${STATUS_COLOR[member.status]} ring-[3px] ring-bg`} />
      </div>
      <span
        className="text-[14px] truncate"
        style={member.roleColor ? { color: member.roleColor } : undefined}
      >
        {member.displayName}
      </span>
    </div>
  );
}
