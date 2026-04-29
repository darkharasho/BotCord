import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
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
    type Group = {
      id: string;
      name: string;
      position: number;
      color: string | null;
      iconUrl: string | null;
      unicodeEmoji: string | null;
      members: ChannelMemberSummary[];
    };
    const byRole = new Map<string, Group>();
    const offline: ChannelMemberSummary[] = [];
    const onlineNoRole: ChannelMemberSummary[] = [];

    for (const m of members) {
      if (m.status === 'offline') { offline.push(m); continue; }
      if (!m.topRole) { onlineNoRole.push(m); continue; }
      const key = m.topRole.id;
      let g = byRole.get(key);
      if (!g) {
        g = {
          id: m.topRole.id,
          name: m.topRole.name,
          position: m.topRole.position,
          color: m.topRole.color,
          iconUrl: m.topRole.iconUrl,
          unicodeEmoji: m.topRole.unicodeEmoji,
          members: [],
        };
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
        <Section
          key={g.id}
          title={`${g.name} — ${g.members.length}`}
          iconUrl={g.iconUrl}
          unicodeEmoji={g.unicodeEmoji}
          roleName={g.name}
          members={g.members}
        />
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

function Section({
  title, members, iconUrl, unicodeEmoji, roleName,
}: {
  title: string;
  members: ChannelMemberSummary[];
  iconUrl?: string | null;
  unicodeEmoji?: string | null;
  roleName?: string;
}) {
  return (
    <div className="mb-4">
      <div className="px-4 mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-dim">
        {iconUrl
          ? <img src={iconUrl} alt={roleName ?? ''} title={roleName} className="w-4 h-4 object-contain" />
          : unicodeEmoji
            ? <span title={roleName} className="text-[14px] leading-none">{unicodeEmoji}</span>
            : null}
        <span>{title}</span>
      </div>
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
        <Avatar
          src={member.avatarUrl}
          alt=""
          className="w-8 h-8 rounded-full"
          fallback={<div className="w-8 h-8 rounded-full bg-bg-input flex items-center justify-center text-[10px] font-semibold">{member.displayName.slice(0, 2).toUpperCase()}</div>}
        />
        {member.status === 'idle' ? (
          <svg aria-hidden className="absolute -bottom-[3px] -right-[3px] w-[14px] h-[14px]" viewBox="0 0 14 14">
            <circle cx="7" cy="7" r="7" className="fill-bg" />
            <mask id="idle-mask">
              <rect width="14" height="14" fill="white" />
              <circle cx="5" cy="4.5" r="3.5" fill="black" />
            </mask>
            <circle cx="7" cy="7" r="5" className="fill-warn" mask="url(#idle-mask)" />
          </svg>
        ) : (
          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${STATUS_COLOR[member.status]} ring-2 ring-bg`} />
        )}
      </div>
      <span
        className="text-[14px] truncate min-w-0 flex-1"
        style={member.roleColor ? { color: member.roleColor } : undefined}
      >
        {member.displayName}
      </span>
    </div>
  );
}
