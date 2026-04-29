import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
import { UserProfileCard } from './UserProfileCard';
import { openContextMenu, updateContextMenuItems } from './ContextMenu';
import { buildUserMenu, type UserMenuTarget } from './UserContextMenu';
import { KickDialog } from './moderation/KickDialog';
import { BanDialog } from './moderation/BanDialog';
import { TimeoutDialog } from './moderation/TimeoutDialog';
import { pushToast } from './Toaster';
import type { ChannelMemberSummary, PresenceStatus, GuildRole, BotCapabilities, MemberDetail } from '../../shared/domain';

const STATUS_COLOR: Record<PresenceStatus, string> = {
  online: 'bg-ok',
  idle: 'bg-warn',
  dnd: 'bg-danger',
  offline: 'bg-fg-dim',
};

type ModState =
  | { kind: 'kick' | 'ban' | 'timeout'; userId: string; displayName: string }
  | null;

export function MemberList({ guildId, channelId }: { guildId: string | null; channelId: string | null }) {
  const [members, setMembers] = useState<ChannelMemberSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [profileState, setProfileState] = useState<{ userId: string; rect: DOMRect } | null>(null);
  const [modState, setModState] = useState<ModState>(null);
  const rolesCache = useRef<Map<string, GuildRole[]>>(new Map());

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

  // Reset cache when guild changes
  useEffect(() => { rolesCache.current = new Map(); }, [guildId]);

  const onContextMenuMember = async (e: React.MouseEvent, m: ChannelMemberSummary) => {
    if (!guildId) return;
    e.preventDefault();
    // React clears the synthetic event's currentTarget after the handler
    // returns, so capture anything we need from it before any awaits.
    const anchorRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;

    const [capRes, memRes] = await Promise.all([
      api.guilds.getBotCapabilities(guildId, m.id),
      api.guilds.getMember(guildId, m.id),
    ]);
    const capabilities: BotCapabilities | null = capRes.ok ? capRes.data : null;
    const detail: MemberDetail | null = memRes.ok ? memRes.data : null;
    if (!capabilities) {
      pushToast('danger', capRes.ok ? 'Failed to load capabilities' : capRes.error.message);
      return;
    }

    const target: UserMenuTarget = {
      guildId,
      userId: m.id,
      username: m.username,
      displayName: m.displayName,
      assignedRoleIds: new Set(detail?.roles.map(r => r.id) ?? []),
    };

    const buildItems = (roles: GuildRole[] | null) => buildUserMenu({
      target,
      capabilities,
      roles,
      callbacks: {
        onOpenProfile:   () => setProfileState({ userId: m.id, rect: anchorRect }),
        onMention:       () => { void api.system.copyText(`<@${m.id}>`); pushToast('ok', 'Mention copied'); },
        onCopyUsername:  () => { void api.system.copyText(m.username); pushToast('ok', 'Username copied'); },
        onCopyUserId:    () => { void api.system.copyText(m.id); pushToast('ok', 'ID copied'); },
        onOpenKick:      () => setModState({ kind: 'kick',    userId: m.id, displayName: m.displayName }),
        onOpenBan:       () => setModState({ kind: 'ban',     userId: m.id, displayName: m.displayName }),
        onOpenTimeout:   () => setModState({ kind: 'timeout', userId: m.id, displayName: m.displayName }),
        onToggleRole: async (roleId, currentlyAssigned) => {
          const res = currentlyAssigned
            ? await api.guilds.removeRole(guildId, m.id, roleId)
            : await api.guilds.assignRole(guildId, m.id, roleId);
          if (!res.ok) pushToast('danger', res.error.message);
        },
      },
    });

    const rolesNow = rolesCache.current.get(guildId) ?? null;
    openContextMenu({ preventDefault: () => {}, clientX, clientY }, buildItems(rolesNow));

    if (!rolesNow) {
      api.guilds.listGuildRoles(guildId).then(res => {
        if (!res.ok) return;
        rolesCache.current.set(guildId, res.data);
        updateContextMenuItems(buildItems(res.data));
      });
    }
  };

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
          onClickMember={(userId, rect) => setProfileState({ userId, rect })}
          onContextMenuMember={onContextMenuMember}
        />
      ))}
      {groups.onlineNoRole.length > 0 && (
        <Section
          title={`Online — ${groups.onlineNoRole.length}`}
          members={groups.onlineNoRole}
          onClickMember={(userId, rect) => setProfileState({ userId, rect })}
          onContextMenuMember={onContextMenuMember}
        />
      )}
      {groups.offline.length > 0 && (
        <Section
          title={`Offline — ${groups.offline.length}`}
          members={groups.offline}
          onClickMember={(userId, rect) => setProfileState({ userId, rect })}
          onContextMenuMember={onContextMenuMember}
        />
      )}
      {profileState && guildId && (
        <UserProfileCard
          guildId={guildId}
          userId={profileState.userId}
          anchorRect={profileState.rect}
          onClose={() => setProfileState(null)}
        />
      )}
      {modState && guildId && modState.kind === 'kick'    && <KickDialog    guildId={guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
      {modState && guildId && modState.kind === 'ban'     && <BanDialog     guildId={guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
      {modState && guildId && modState.kind === 'timeout' && <TimeoutDialog guildId={guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
    </aside>
  );
}

function Section({
  title, members, iconUrl, unicodeEmoji, roleName, onClickMember, onContextMenuMember,
}: {
  title: string;
  members: ChannelMemberSummary[];
  iconUrl?: string | null;
  unicodeEmoji?: string | null;
  roleName?: string;
  onClickMember: (userId: string, rect: DOMRect) => void;
  onContextMenuMember: (e: React.MouseEvent, m: ChannelMemberSummary) => void;
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
        {members.map(m => (
          <MemberRow
            key={m.id}
            member={m}
            onClickMember={onClickMember}
            onContextMenu={(e) => onContextMenuMember(e, m)}
          />
        ))}
      </div>
    </div>
  );
}

function MemberRow({
  member, onClickMember, onContextMenu,
}: {
  member: ChannelMemberSummary;
  onClickMember: (userId: string, rect: DOMRect) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const dim = member.status === 'offline';
  return (
    <div
      className={`flex items-center gap-2 px-2 mx-2 py-1 rounded hover:bg-hover cursor-pointer ${dim ? 'opacity-40' : ''}`}
      title={`@${member.username}${member.topRole ? ` · ${member.topRole.name}` : ''}`}
      onClick={(e) => onClickMember(member.id, (e.currentTarget as HTMLElement).getBoundingClientRect())}
      onContextMenu={onContextMenu}
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
