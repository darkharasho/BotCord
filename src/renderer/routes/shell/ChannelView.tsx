import { useEffect, useRef, useState } from 'react';
import { MessageList } from '../../components/MessageList';
import { Composer } from '../../components/Composer';
import { MemberList } from '../../components/MemberList';
import { ForumPostHeader } from '../../components/ForumPostHeader';
import { TypingIndicator } from '../../components/TypingIndicator';
import { IconHash, IconSearch, IconUsers, IconX, IconArrowLeft, IconPinned } from '@tabler/icons-react';
import { api } from '../../lib/api';
import { PinnedMessagesPopover } from '../../components/PinnedMessagesPopover';
import { WelcomePane } from '../../components/WelcomePane';
import { subscribeComposerBus } from '../../lib/composer-bus';

export function ChannelView({ channelId, guildId, channelName, backToForum }: {
  channelId: string | null;
  guildId: string | null;
  channelName: string | null;
  backToForum?: { id: string; name: string; onClick: () => void };
}) {
  const [showMembers, setShowMembers] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ messageId: string; authorDisplayName: string } | null>(null);
  const memberPrefHydrated = useRef(false);

  // Hydrate the persisted member-list toggle on first mount, then save on change.
  useEffect(() => {
    api.prefs.get('memberListOpen').then(res => {
      if (res.ok && typeof res.data === 'boolean') setShowMembers(res.data);
      memberPrefHydrated.current = true;
    });
  }, []);
  useEffect(() => {
    if (!memberPrefHydrated.current) return;
    api.prefs.set('memberListOpen', showMembers);
  }, [showMembers]);

  // Reset transient header state when switching channels.
  useEffect(() => { setSearch(''); setSearchOpen(false); setPinnedOpen(false); setJumpTarget(null); setReplyTo(null); }, [channelId]);

  // Let the composer-bus drive the reply target — used by "Generate reply
  // with Claude" so the drafted message sends as a Discord reply.
  useEffect(() => {
    return subscribeComposerBus((action) => {
      if (action.channelId !== channelId) return;
      if (action.kind === 'setReplyTarget') {
        setReplyTo({ messageId: action.messageId, authorDisplayName: action.authorDisplayName });
      }
    });
  }, [channelId]);

  if (!channelId) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-bg border-t border-l border-white/[0.04] overflow-hidden">
        <WelcomePane hasGuild={!!guildId} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg border-t border-l border-white/[0.04] overflow-hidden">
      <div className="h-12 flex items-center px-4 shrink-0 border-b border-white/[0.04] gap-2">
        {backToForum ? (
          <>
            <button
              onClick={backToForum.onClick}
              className="flex items-center gap-1 text-fg-dim hover:text-fg transition-colors duration-150 group shrink-0 min-w-0"
              title={`Back to ${backToForum.name}`}
            >
              <IconArrowLeft size={16} stroke={2} className="shrink-0" />
              <span className="text-[13px] truncate max-w-[180px]">{backToForum.name}</span>
            </button>
            <span className="text-fg-dim/60 shrink-0">/</span>
            <span className="font-semibold text-fg text-base truncate">{channelName ?? ''}</span>
          </>
        ) : (
          <>
            <IconHash size={22} stroke={2} className="text-fg-dim shrink-0" />
            <span className="font-semibold text-fg text-base truncate">{channelName ?? 'Select a channel'}</span>
          </>
        )}
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
        <div className="relative">
          <button
            onClick={() => setPinnedOpen(o => !o)}
            className={`p-1 rounded hover:bg-hover ${pinnedOpen ? 'text-fg' : 'text-fg-dim hover:text-fg'}`}
            title="Pinned messages"
          >
            <IconPinned size={18} stroke={1.75} />
          </button>
          {pinnedOpen && (
            <PinnedMessagesPopover
              channelId={channelId}
              onClose={() => setPinnedOpen(false)}
              onJump={(id) => { setJumpTarget(id); setPinnedOpen(false); }}
            />
          )}
        </div>
        <button
          onClick={() => setShowMembers(s => !s)}
          className={`p-1 rounded hover:bg-hover ${showMembers ? 'text-fg' : 'text-fg-dim hover:text-fg'}`}
          title={showMembers ? 'Hide member list' : 'Show member list'}
        >
          <IconUsers size={18} stroke={1.75} />
        </button>
      </div>
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <MessageList
            channelId={channelId}
            filter={search}
            onReply={(message) => setReplyTo({ messageId: message.id, authorDisplayName: message.authorDisplayName })}
            header={backToForum && guildId && channelId
              ? <ForumPostHeader guildId={guildId} forumId={backToForum.id} postId={channelId} fallbackTitle={channelName ?? ''} />
              : null}
            jumpToMessageId={jumpTarget}
            onJumpComplete={() => setJumpTarget(null)}
            scrollToBottomTrigger={replyTo}
          />
          <TypingIndicator channelId={channelId} />
          <Composer
            channelId={channelId}
            guildId={guildId}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
          />
        </div>
        {showMembers && <MemberList guildId={guildId} channelId={channelId} />}
      </div>
    </div>
  );
}
