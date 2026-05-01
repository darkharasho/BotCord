import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { DMChannelRow } from '@shared/domain';
import { DMListItem } from './DMListItem';
import { NewDMModal } from './NewDMModal';
import { useUnreads } from '../lib/use-unreads';

export function DMList({
  activeChannelId,
  onSelect,
}: {
  activeChannelId: string | null;
  onSelect: (channelId: string) => void;
}) {
  const [rows, setRows] = useState<DMChannelRow[]>([]);
  const [query, setQuery] = useState('');
  const [showNewDM, setShowNewDM] = useState(false);
  const unreads = useUnreads(activeChannelId);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const res = await api.dms.list();
      if (!cancelled && res.ok) setRows(res.data);
    };
    refresh();
    const offCreate = api.events.onMessageCreate(({ message }) => {
      if (message.guildId) return;
      // A DM message arrived — refresh list to pick up new rows / reorder.
      void refresh();
    });
    return () => { cancelled = true; offCreate(); };
  }, []);

  const filtered = query.trim()
    ? rows.filter(r => {
      const q = query.toLowerCase();
      return r.userUsername.toLowerCase().includes(q)
        || (r.userGlobalName?.toLowerCase().includes(q) ?? false);
    })
    : rows;

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex items-center gap-2 border-b border-border p-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Find a DM"
          className="flex-1 rounded bg-bg-subtle px-2 py-1 text-sm text-fg placeholder:text-fg-dim focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShowNewDM(true)}
          className="rounded bg-bg-subtle px-2 py-1 text-sm text-fg hover:bg-hover"
          aria-label="New DM"
        >
          +
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {filtered.length === 0 && (
          <div className="p-4 text-center text-sm text-fg-dim">No conversations yet.</div>
        )}
        {filtered.map(row => {
          const isActive = row.channelId === activeChannelId;
          return (
            <DMListItem
              key={row.channelId}
              row={row}
              active={isActive}
              unread={unreads.dmUnreadChannelIds.has(row.channelId)}
              mentionCount={isActive ? 0 : (unreads.mentionChannelCounts.get(row.channelId) ?? 0)}
              onClick={() => onSelect(row.channelId)}
            />
          );
        })}
      </div>
      {showNewDM && (
        <NewDMModal
          onClose={() => setShowNewDM(false)}
          onOpened={(row) => {
            setShowNewDM(false);
            setRows(prev => [row, ...prev.filter(r => r.channelId !== row.channelId)]);
            onSelect(row.channelId);
          }}
        />
      )}
    </div>
  );
}
