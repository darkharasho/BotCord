import { useEffect, useState } from 'react';
import { MessageList } from '../../components/MessageList';
import { Composer } from '../../components/Composer';
import { MemberList } from '../../components/MemberList';
import { IconHash, IconSearch, IconUsers, IconX } from '@tabler/icons-react';

export function ChannelView({ channelId, guildId, channelName }: { channelId: string | null; guildId: string | null; channelName: string | null }) {
  const [showMembers, setShowMembers] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Reset transient header state when switching channels.
  useEffect(() => { setSearch(''); setSearchOpen(false); }, [channelId]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg border-t border-l border-white/[0.04] overflow-hidden">
      <div className="h-12 flex items-center px-4 shrink-0 border-b border-white/[0.04] gap-2">
        <IconHash size={22} stroke={2} className="text-fg-dim shrink-0" />
        <span className="font-semibold text-fg text-base truncate">{channelName ?? 'Select a channel'}</span>
        <div className="flex-1" />
        {searchOpen ? (
          <div className="flex items-center bg-bg-input rounded h-7 px-2 gap-1.5 w-56">
            <IconSearch size={14} stroke={2} className="text-fg-dim shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); setSearchOpen(false); } }}
              placeholder="Search messages…"
              className="flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-dim min-w-0"
            />
            <button
              onClick={() => { setSearch(''); setSearchOpen(false); }}
              className="text-fg-dim hover:text-fg shrink-0"
              title="Close search"
            >
              <IconX size={14} stroke={2} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSearchOpen(true)}
            className="text-fg-dim hover:text-fg p-1 rounded hover:bg-hover"
            title="Search"
          >
            <IconSearch size={18} stroke={1.75} />
          </button>
        )}
        <button
          onClick={() => setShowMembers(s => !s)}
          className={`p-1 rounded hover:bg-hover ${showMembers ? 'text-fg' : 'text-fg-dim hover:text-fg'}`}
          title={showMembers ? 'Hide member list' : 'Show member list'}
        >
          <IconUsers size={18} stroke={1.75} />
        </button>
      </div>
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-h-0">
          <MessageList channelId={channelId} filter={search} />
          <Composer channelId={channelId} guildId={guildId} />
        </div>
        {showMembers && <MemberList guildId={guildId} channelId={channelId} />}
      </div>
    </div>
  );
}
