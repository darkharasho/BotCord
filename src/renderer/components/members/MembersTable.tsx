import type * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { Avatar } from '../Avatar';
import { openContextMenu } from '../ContextMenu';
import { buildUserMenu, type UserMenuTarget } from '../UserContextMenu';
import { KickDialog } from '../moderation/KickDialog';
import { BanDialog } from '../moderation/BanDialog';
import { TimeoutDialog } from '../moderation/TimeoutDialog';
import { pushToast } from '../Toaster';
import { api } from '../../lib/api';
import { IconChevronUp, IconChevronDown, IconDots } from '@tabler/icons-react';
import type { AllMembersEntry, BotCapabilities, GuildRole, MemberDetail } from '../../../shared/domain';

export type SortKey = 'name' | 'joinedAt' | 'createdAt';
export type SortDir = 'asc' | 'desc';

const ROW_HEIGHT = 44;

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const formatDate = (ms: number | null): string => ms == null ? '—' : dateFmt.format(new Date(ms));

type RowExtraProps = {
  rows: AllMembersEntry[];
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
  rolesById: Map<string, GuildRole>;
  onMore: (e: React.MouseEvent, m: AllMembersEntry) => void;
};

type RowProps = RowComponentProps<RowExtraProps>;

function Row({ index, style, rows, selected, onToggleSelected, rolesById, onMore }: RowProps): React.ReactElement {
  const m = rows[index]!;
  const isChecked = selected.has(m.id);
  return (
    <div style={style} className="flex items-center px-4 gap-3 hover:bg-hover text-[13px]">
      <input
        type="checkbox"
        checked={isChecked}
        onChange={() => onToggleSelected(m.id)}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0"
      />
      <div className="flex items-center gap-2 min-w-0 w-[260px]">
        <Avatar
          src={m.avatarUrl}
          alt=""
          className="w-6 h-6 rounded-full shrink-0"
          fallback={<div className="w-6 h-6 rounded-full bg-bg-input flex items-center justify-center text-[9px] font-semibold">{m.displayName.slice(0, 2).toUpperCase()}</div>}
        />
        <span
          className="truncate font-medium"
          style={m.roleColor ? { color: m.roleColor } : undefined}
        >{m.displayName}</span>
        <span className="text-fg-dim truncate">@{m.username}</span>
      </div>
      <div className="w-[120px] text-fg-dim shrink-0">{formatDate(m.joinedAt)}</div>
      <div className="w-[120px] text-fg-dim shrink-0">{formatDate(m.createdAt)}</div>
      <div className="flex-1 min-w-0 flex items-center gap-1 truncate" title={m.roleIds.map(id => rolesById.get(id)?.name).filter(Boolean).join(', ')}>
        {m.roleIds.slice(0, 3).map(id => {
          const r = rolesById.get(id);
          if (!r) return null;
          return (
            <span
              key={id}
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: r.color ?? 'rgba(255,255,255,0.2)' }}
            />
          );
        })}
        {m.roleIds.length > 3 && <span className="text-fg-dim text-[11px] ml-1">+{m.roleIds.length - 3}</span>}
      </div>
      <button
        type="button"
        onClick={(e) => onMore(e, m)}
        className="shrink-0 p-1 rounded hover:bg-hover text-fg-dim hover:text-fg"
        aria-label="Actions"
      >
        <IconDots size={16} />
      </button>
    </div>
  );
}

export function MembersTable({
  guildId,
  rows,
  selected,
  onToggleSelected,
  onToggleAllFiltered,
  sortKey,
  sortDir,
  onSort,
  rolesById,
}: {
  guildId: string;
  rows: AllMembersEntry[];
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
  onToggleAllFiltered: () => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  rolesById: Map<string, GuildRole>;
}) {
  const [modState, setModState] = useState<{ kind: 'kick' | 'ban' | 'timeout'; userId: string; displayName: string } | null>(null);
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const someSelected = !allSelected && rows.some(r => selected.has(r.id));

  const headerCol = (label: string, key: SortKey | null) => {
    const active = key !== null && sortKey === key;
    const sortable = key !== null;
    return (
      <button
        type="button"
        disabled={!sortable}
        onClick={() => sortable && onSort(key)}
        className={`flex items-center gap-1 ${sortable ? 'hover:text-fg' : ''} ${active ? 'text-fg' : 'text-fg-dim'}`}
      >
        <span>{label}</span>
        {active && (sortDir === 'asc' ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />)}
      </button>
    );
  };

  const onMore = useCallback(async (e: React.MouseEvent, m: AllMembersEntry) => {
    e.preventDefault();
    e.stopPropagation();
    const anchorRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clientX = anchorRect.right;
    const clientY = anchorRect.bottom;

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
    const items = buildUserMenu({
      target,
      capabilities,
      roles: Array.from(rolesById.values()),
      callbacks: {
        onOpenProfile:  () => pushToast('info', `Profile for @${m.username}`),
        onMention:      () => { void api.system.copyText(`<@${m.id}>`); pushToast('ok', 'Mention copied'); },
        onCopyUsername: () => { void api.system.copyText(m.username); pushToast('ok', 'Username copied'); },
        onCopyUserId:   () => { void api.system.copyText(m.id); pushToast('ok', 'ID copied'); },
        onOpenKick:     () => setModState({ kind: 'kick',    userId: m.id, displayName: m.displayName }),
        onOpenBan:      () => setModState({ kind: 'ban',     userId: m.id, displayName: m.displayName }),
        onOpenTimeout:  () => setModState({ kind: 'timeout', userId: m.id, displayName: m.displayName }),
        onToggleRole: async (roleId, currentlyAssigned) => {
          const res = currentlyAssigned
            ? await api.guilds.removeRole(guildId, m.id, roleId)
            : await api.guilds.assignRole(guildId, m.id, roleId);
          if (!res.ok) pushToast('danger', res.error.message);
        },
      },
    });
    openContextMenu({ preventDefault: () => {}, clientX, clientY }, items);
  }, [guildId, rolesById]);

  const rowProps = useMemo(
    () => ({ rows, selected, onToggleSelected, rolesById, onMore }),
    [rows, selected, onToggleSelected, rolesById, onMore],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center px-4 gap-3 h-9 text-[12px] uppercase tracking-wide font-semibold border-b border-white/[0.04] text-fg-dim shrink-0">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => { if (el) el.indeterminate = someSelected; }}
          onChange={onToggleAllFiltered}
          className="shrink-0"
          aria-label="Select all"
        />
        <div className="w-[260px]">{headerCol('Name', 'name')}</div>
        <div className="w-[120px] shrink-0">{headerCol('Member since', 'joinedAt')}</div>
        <div className="w-[120px] shrink-0">{headerCol('Joined Discord', 'createdAt')}</div>
        <div className="flex-1 min-w-0">{headerCol('Roles', null)}</div>
        <div className="w-6 shrink-0" />
      </div>
      <div className="flex-1 min-h-0">
        <List
          rowComponent={Row}
          rowCount={rows.length}
          rowHeight={ROW_HEIGHT}
          rowProps={rowProps}
          style={{ height: '100%' }}
        />
      </div>
      {modState && modState.kind === 'kick'    && <KickDialog    guildId={guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
      {modState && modState.kind === 'ban'     && <BanDialog     guildId={guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
      {modState && modState.kind === 'timeout' && <TimeoutDialog guildId={guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
    </div>
  );
}
