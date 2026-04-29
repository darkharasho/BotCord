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
import { IconChevronUp, IconChevronDown, IconDots, IconAdjustmentsHorizontal } from '@tabler/icons-react';
import type { AllMembersEntry, BotCapabilities, GuildRole, MemberDetail } from '../../../shared/domain';
import { ColumnFilterPopover } from './ColumnFilterPopover';
import { DateRangeFilter } from './DateRangeFilter';
import { RoleMultiFilter } from './RoleMultiFilter';

export type SortKey = 'name' | 'joinedAt' | 'createdAt';
export type SortDir = 'asc' | 'desc';

const ROW_HEIGHT = 44;

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const formatDate = (ms: number | null): string => ms == null ? '—' : dateFmt.format(new Date(ms));

// Convert "#rrggbb" → "rgba(r, g, b, a)". Returns null on bad input.
function hexToRgba(hex: string | null, alpha: number): string | null {
  if (!hex) return null;
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Custom CheckBox component
function CheckBox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const filled = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={`relative inline-flex items-center justify-center w-[18px] h-[18px] rounded-[4px] border transition-colors shrink-0 ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : filled
            ? (indeterminate ? 'bg-accent/40 border-accent' : 'bg-accent border-accent')
            : 'bg-transparent border-white/30 hover:border-white/60'
      }`}
    >
      {checked && !indeterminate && (
        <svg viewBox="0 0 16 16" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 8 7 12 13 4" />
        </svg>
      )}
      {indeterminate && (
        <span className="block w-2.5 h-[2px] bg-white rounded-full" />
      )}
    </button>
  );
}

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
      <CheckBox
        checked={isChecked}
        onChange={() => onToggleSelected(m.id)}
        ariaLabel={`Select ${m.displayName}`}
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
      <div
        className="flex-1 min-w-0 flex flex-wrap items-center gap-1"
        title={m.roleIds.map(id => rolesById.get(id)?.name).filter(Boolean).join(', ')}
      >
        {m.roleIds.map(id => {
          const r = rolesById.get(id);
          if (!r) return null;
          const dotColor = r.color ?? 'rgba(255,255,255,0.4)';
          const bg = hexToRgba(r.color, 0.16) ?? 'rgba(255,255,255,0.04)';
          const border = hexToRgba(r.color, 0.4) ?? 'rgba(255,255,255,0.08)';
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 pl-1.5 pr-2 py-[3px] rounded-md text-[12px] leading-none shrink-0 text-fg border"
              style={{ backgroundColor: bg, borderColor: border }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: dotColor }}
              />
              {r.iconUrl
                ? <img src={r.iconUrl} alt="" className="w-3.5 h-3.5 object-contain shrink-0" />
                : r.unicodeEmoji
                  ? <span className="text-[12px] leading-none shrink-0">{r.unicodeEmoji}</span>
                  : null}
              <span className="truncate">{r.name}</span>
            </span>
          );
        })}
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
  roles,
  memberSinceFrom,
  memberSinceTo,
  onMemberSinceFrom,
  onMemberSinceTo,
  createdAtFrom,
  createdAtTo,
  onCreatedAtFrom,
  onCreatedAtTo,
  roleFilters,
  onRoleFiltersToggle,
  onRoleFiltersClear,
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
  roles: GuildRole[];
  memberSinceFrom: number | null;
  memberSinceTo: number | null;
  onMemberSinceFrom: (v: number | null) => void;
  onMemberSinceTo: (v: number | null) => void;
  createdAtFrom: number | null;
  createdAtTo: number | null;
  onCreatedAtFrom: (v: number | null) => void;
  onCreatedAtTo: (v: number | null) => void;
  roleFilters: Set<string>;
  onRoleFiltersToggle: (roleId: string) => void;
  onRoleFiltersClear: () => void;
}) {
  const [modState, setModState] = useState<{ kind: 'kick' | 'ban' | 'timeout'; userId: string; displayName: string } | null>(null);
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const someSelected = !allSelected && rows.some(r => selected.has(r.id));

  // Popover anchor state
  const [openPopover, setOpenPopover] = useState<'memberSince' | 'createdAt' | 'roles' | null>(null);
  const [memberSinceAnchor, setMemberSinceAnchor] = useState<HTMLButtonElement | null>(null);
  const [createdAtAnchor, setCreatedAtAnchor] = useState<HTMLButtonElement | null>(null);
  const [rolesAnchor, setRolesAnchor] = useState<HTMLButtonElement | null>(null);

  const memberSinceActive = memberSinceFrom != null || memberSinceTo != null;
  const createdAtActive = createdAtFrom != null || createdAtTo != null;
  const rolesActive = roleFilters.size > 0;

  const headerCol = (label: string, key: SortKey | null, filterKey?: 'memberSince' | 'createdAt' | 'roles', setAnchor?: (el: HTMLButtonElement | null) => void, isFilterActive?: boolean) => {
    const active = key !== null && sortKey === key;
    const sortable = key !== null;
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={!sortable}
          onClick={() => sortable && onSort(key)}
          className={`flex items-center gap-1 ${sortable ? 'hover:text-fg' : ''} ${active ? 'text-fg' : 'text-fg-dim'}`}
        >
          <span>{label}</span>
          {active && (sortDir === 'asc' ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />)}
        </button>
        {filterKey && setAnchor && (
          <button
            type="button"
            ref={setAnchor}
            onClick={() => setOpenPopover(prev => prev === filterKey ? null : filterKey)}
            className={`p-0.5 rounded hover:bg-white/[0.08] transition-colors ${isFilterActive ? 'text-accent' : 'text-fg-dim hover:text-fg'}`}
            aria-label={`Filter by ${label}`}
          >
            <IconAdjustmentsHorizontal size={13} />
          </button>
        )}
      </div>
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
        <CheckBox
          checked={allSelected}
          indeterminate={someSelected}
          onChange={onToggleAllFiltered}
          ariaLabel="Select all"
        />
        <div className="w-[260px]">{headerCol('Name', 'name')}</div>
        <div className="w-[120px] shrink-0">
          {headerCol('Member since', 'joinedAt', 'memberSince', setMemberSinceAnchor, memberSinceActive)}
        </div>
        <div className="w-[120px] shrink-0">
          {headerCol('Joined Discord', 'createdAt', 'createdAt', setCreatedAtAnchor, createdAtActive)}
        </div>
        <div className="flex-1 min-w-0">
          {headerCol('Roles', null, 'roles', setRolesAnchor, rolesActive)}
        </div>
        <div className="w-6 shrink-0" />
      </div>

      {/* Popovers */}
      {openPopover === 'memberSince' && (
        <ColumnFilterPopover
          anchor={memberSinceAnchor}
          onClose={() => setOpenPopover(null)}
        >
          <DateRangeFilter
            from={memberSinceFrom}
            to={memberSinceTo}
            onFrom={onMemberSinceFrom}
            onTo={onMemberSinceTo}
            onClose={() => setOpenPopover(null)}
          />
        </ColumnFilterPopover>
      )}
      {openPopover === 'createdAt' && (
        <ColumnFilterPopover
          anchor={createdAtAnchor}
          onClose={() => setOpenPopover(null)}
        >
          <DateRangeFilter
            from={createdAtFrom}
            to={createdAtTo}
            onFrom={onCreatedAtFrom}
            onTo={onCreatedAtTo}
            onClose={() => setOpenPopover(null)}
          />
        </ColumnFilterPopover>
      )}
      {openPopover === 'roles' && (
        <ColumnFilterPopover
          anchor={rolesAnchor}
          onClose={() => setOpenPopover(null)}
        >
          <RoleMultiFilter
            roles={roles}
            selected={roleFilters}
            onToggle={onRoleFiltersToggle}
            onClear={onRoleFiltersClear}
          />
        </ColumnFilterPopover>
      )}

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
