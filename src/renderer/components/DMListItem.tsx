import { Avatar } from './Avatar';
import type { DMChannelRow } from '@shared/domain';

export function DMListItem({
  row, active, unread, mentionCount, onClick,
}: {
  row: DMChannelRow;
  active: boolean;
  unread: boolean;
  mentionCount: number;
  onClick: () => void;
}) {
  const displayName = row.userGlobalName ?? row.userUsername;
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors duration-150 ' +
        (active ? 'bg-selected text-fg' : 'hover:bg-hover')
      }
    >
      <Avatar
        src={row.userAvatar}
        alt={displayName}
        className="w-8 h-8 rounded-full shrink-0"
        fallback={<div className="w-8 h-8 rounded-full bg-bg-input shrink-0" />}
      />
      <div className="min-w-0 flex-1">
        <div className={'truncate text-sm ' + (active || unread ? 'text-fg' : 'text-fg-dim')}>
          {displayName}
        </div>
        {row.lastMessagePreview && (
          <div className="truncate text-xs text-fg-dim">{row.lastMessagePreview}</div>
        )}
      </div>
      {mentionCount > 0 && (
        <span className="min-w-[18px] rounded-full bg-danger px-1 text-[10px] font-semibold leading-[18px] text-white text-center">
          {mentionCount > 99 ? '99+' : mentionCount}
        </span>
      )}
    </button>
  );
}
