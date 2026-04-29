import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from '@tabler/icons-react';
import { api } from '../lib/api';
import type { MessageSummary, ReactionSummary } from '../../shared/domain';

type ReactionUser = { id: string; displayName: string; avatarUrl: string | null };

// Module-level cache keyed by `${messageId}:${emojiKey}` so re-hovers don't
// refetch and so the same emoji on different messages stays distinct.
const userCache = new Map<string, ReactionUser[]>();
const inflight = new Map<string, Promise<ReactionUser[]>>();

const cacheKey = (messageId: string, r: ReactionSummary): string =>
  `${messageId}:${r.emojiId ?? r.emojiName}`;

async function loadUsers(channelId: string, messageId: string, r: ReactionSummary): Promise<ReactionUser[]> {
  const key = cacheKey(messageId, r);
  const cached = userCache.get(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = api.messages.fetchReactionUsers(channelId, messageId, { id: r.emojiId, name: r.emojiName })
    .then(res => {
      const list = res.ok ? res.data : [];
      userCache.set(key, list);
      inflight.delete(key);
      return list;
    });
  inflight.set(key, promise);
  return promise;
}

export function ReactionBar({ message }: { message: MessageSummary }) {
  if (message.reactions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {message.reactions.map(r => (
        <ReactionPill
          key={r.emojiId ?? r.emojiName}
          channelId={message.channelId}
          messageId={message.id}
          reaction={r}
          onToggle={() => {
            void api.messages.toggleReaction(message.channelId, message.id, {
              id: r.emojiId,
              name: r.emojiName,
              animated: r.animated,
            });
          }}
        />
      ))}
    </div>
  );
}

function ReactionPill({
  channelId, messageId, reaction, onToggle,
}: {
  channelId: string;
  messageId: string;
  reaction: ReactionSummary;
  onToggle: () => void;
}) {
  const pillRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [users, setUsers] = useState<ReactionUser[] | null>(userCache.get(cacheKey(messageId, reaction)) ?? null);
  const [modalOpen, setModalOpen] = useState(false);
  // Grace timer so moving from pill to tooltip (or vice versa) doesn't
  // dismiss it. Both elements share these handlers.
  const hideTimer = useRef<number | null>(null);

  const cancelHide = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setHovered(false), 120);
  };

  const onEnter = () => {
    cancelHide();
    setHovered(true);
    if (!userCache.has(cacheKey(messageId, reaction))) {
      void loadUsers(channelId, messageId, reaction).then(list => setUsers(list));
    } else {
      setUsers(userCache.get(cacheKey(messageId, reaction))!);
    }
  };

  useEffect(() => () => cancelHide(), []);

  const url = reaction.emojiId
    ? `https://cdn.discordapp.com/emojis/${reaction.emojiId}.${reaction.animated ? 'gif' : 'png'}`
    : null;
  const showOverflow = (users?.length ?? 0) > 2;
  const pillRect = hovered ? pillRef.current?.getBoundingClientRect() ?? null : null;

  return (
    <>
      <button
        ref={pillRef}
        onClick={onToggle}
        onMouseEnter={onEnter}
        onMouseLeave={scheduleHide}
        className={`relative inline-flex items-center gap-1 h-[22px] px-1.5 rounded border text-[12px] leading-none transition-colors duration-150
          ${reaction.me
            ? 'bg-accent/15 border-accent/40 text-fg hover:bg-accent/25 hover:border-accent/60'
            : 'bg-white/[0.04] border-white/[0.06] text-fg-muted hover:bg-white/[0.08] hover:border-white/[0.12] hover:text-fg'}`}
      >
        {url
          ? <img src={url} alt={reaction.emojiName} className="w-[16px] h-[16px]" />
          : <span className="text-[15px] leading-none">{reaction.emojiName}</span>}
        <span className="font-medium tabular-nums">{reaction.count}</span>
      </button>

      {pillRect && createPortal(
        <ReactionTooltip
          rect={pillRect}
          reaction={reaction}
          users={users}
          showOverflow={showOverflow}
          onEnter={cancelHide}
          onLeave={scheduleHide}
          onSeeAll={() => { cancelHide(); setHovered(false); setModalOpen(true); }}
        />,
        document.body,
      )}

      {modalOpen && (
        <ReactionVotersModal
          reaction={reaction}
          users={users ?? []}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

function ReactionTooltip({
  rect, reaction, users, showOverflow, onEnter, onLeave, onSeeAll,
}: {
  rect: DOMRect;
  reaction: ReactionSummary;
  users: ReactionUser[] | null;
  showOverflow: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onSeeAll: () => void;
}) {
  const url = reaction.emojiId
    ? `https://cdn.discordapp.com/emojis/${reaction.emojiId}.${reaction.animated ? 'gif' : 'png'}`
    : null;
  // Anchor above the pill, horizontally centered.
  const left = rect.left + rect.width / 2;
  const top = rect.top - 8;

  return (
    <div
      className="fixed z-50 animate-fade-in"
      style={{ left, top, transform: 'translate(-50%, -100%)' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-bg-sunken border border-white/[0.08] shadow-xl text-[12px] text-fg max-w-[360px]">
        {url
          ? <img src={url} alt="" className="w-8 h-8 shrink-0" />
          : <span className="text-[28px] leading-none shrink-0">{reaction.emojiName}</span>}
        <span className="truncate">
          <span className="text-fg-muted">:{reaction.emojiName}:</span>
          <span className="text-fg-muted"> reacted by </span>
          {showOverflow && users
            ? <>
                <span className="text-fg">{users[0]!.displayName}, {users[1]!.displayName} and </span>
                <button
                  onClick={onSeeAll}
                  className="text-link hover:underline cursor-pointer"
                >
                  {users.length - 2} {users.length - 2 === 1 ? 'other' : 'others'}
                </button>
              </>
            : <span className="text-fg">{formatUsers(users, reaction.count)}</span>}
        </span>
      </div>
    </div>
  );
}

function ReactionVotersModal({
  reaction, users, onClose,
}: {
  reaction: ReactionSummary;
  users: ReactionUser[];
  onClose: () => void;
}) {
  const url = reaction.emojiId
    ? `https://cdn.discordapp.com/emojis/${reaction.emojiId}.${reaction.animated ? 'gif' : 'png'}`
    : null;
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-bg-subtle border border-white/[0.06] rounded-xl w-[24rem] max-w-[92vw] max-h-[80vh] flex flex-col shadow-2xl animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {url
              ? <img src={url} alt="" className="w-6 h-6 shrink-0" />
              : <span className="text-[20px] leading-none shrink-0">{reaction.emojiName}</span>}
            <h2 className="text-[15px] font-semibold text-fg truncate">
              <span className="text-fg-muted">:{reaction.emojiName}:</span> · {users.length} {users.length === 1 ? 'person' : 'people'}
            </h2>
          </div>
          <button onClick={onClose} className="text-fg-muted hover:text-fg p-1 rounded transition-colors" title="Close">
            <IconX size={18} stroke={2} />
          </button>
        </div>
        <ul className="overflow-y-auto py-2">
          {users.map(u => (
            <li key={u.id} className="flex items-center gap-3 px-5 py-1.5 hover:bg-hover/40 transition-colors">
              {u.avatarUrl
                ? <img src={u.avatarUrl} alt="" className="w-8 h-8 rounded-full shrink-0" />
                : <div className="w-8 h-8 rounded-full bg-bg-input shrink-0" />}
              <span className="text-fg text-[14px] truncate">{u.displayName}</span>
            </li>
          ))}
          {users.length === 0 && (
            <li className="px-5 py-3 text-fg-muted text-[13px] text-center">Loading…</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// Show up to two names then "+N others"; before users load, fall back to
// the count so the tooltip doesn't appear empty.
function formatUsers(users: ReactionUser[] | null, count: number): string {
  if (!users || users.length === 0) return `${count} ${count === 1 ? 'person' : 'people'}`;
  if (users.length === 1) return users[0]!.displayName;
  if (users.length === 2) return `${users[0]!.displayName} and ${users[1]!.displayName}`;
  const extra = users.length - 2;
  return `${users[0]!.displayName}, ${users[1]!.displayName} and ${extra} ${extra === 1 ? 'other' : 'others'}`;
}
