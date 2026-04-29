import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { MessageSummary } from '../../shared/domain';
import { useChannelMessages } from '../lib/use-channel-messages';
import { useBotIdentity } from '../lib/use-bot-identity';
import { MessageGroup } from './MessageGroup';
import { SystemMessageRow } from './SystemMessageRow';
import { MessageSkeleton } from './MessageSkeleton';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

// Stable per-day key derived in local time so messages on the same calendar
// day always share a separator regardless of the user's timezone offset.
function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDateLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'long', day: 'numeric' }
    : { month: 'long', day: 'numeric', year: 'numeric' });
}

function DateSeparator({ ts }: { ts: number }) {
  return (
    <div
      role="separator"
      aria-label={formatDateLabel(ts)}
      className="relative flex items-center justify-center my-4 px-4 select-none"
    >
      <span aria-hidden className="absolute inset-x-4 top-1/2 h-px bg-white/[0.08]" />
      <span className="relative bg-bg px-2 text-[11px] font-semibold text-fg-muted uppercase tracking-wider">
        {formatDateLabel(ts)}
      </span>
    </div>
  );
}

function renderGroupsWithDateSeparators(
  groups: MessageSummary[][],
  onReply?: ((m: MessageSummary) => void) | undefined,
): ReactNode[] {
  const out: ReactNode[] = [];
  let lastDayKey: string | null = null;
  groups.forEach((g, gi) => {
    const head = g[0]!;
    const dayKey = dayKeyOf(head.createdAt);
    if (dayKey !== lastDayKey) {
      out.push(<DateSeparator key={`d-${dayKey}`} ts={head.createdAt} />);
      lastDayKey = dayKey;
    }
    if (head.systemKind) {
      out.push(<SystemMessageRow key={`s-${gi}-${head.id}`} message={head} />);
    } else {
      out.push(<MessageGroup key={`g-${gi}-${head.id}`} messages={g} onReply={onReply} />);
    }
  });
  return out;
}

function groupMessages(messages: MessageSummary[]): MessageSummary[][] {
  const groups: MessageSummary[][] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    const canGroup = prev
      && !prev.systemKind
      && !m.systemKind
      && !m.replyTo // replies always start a fresh group so the preview + avatar render
      && prev.authorId === m.authorId
      && (m.createdAt - prev.createdAt) < GROUP_WINDOW_MS;
    if (canGroup) {
      last!.push(m);
    } else {
      groups.push([m]);
    }
  }
  return groups;
}

export function MessageList({ channelId, filter, onReply, header, jumpToMessageId, onJumpComplete }: {
  channelId: string | null;
  filter?: string;
  onReply?: ((m: MessageSummary) => void) | undefined;
  // Optional content to render above the first message inside the scroll
  // container — used by ChannelView to show a forum-post intro for threads
  // under a forum parent.
  header?: ReactNode;
  // When set, scroll the message with this id into view and briefly flash
  // it. Caller bumps the value (e.g. from a pinned-list "Jump" click).
  jumpToMessageId?: string | null;
  onJumpComplete?: () => void;
}) {
  const { messages: allMessages, loading, hasMore, loadOlder, error } = useChannelMessages(channelId);
  const bot = useBotIdentity();
  const trimmed = filter?.trim().toLowerCase() ?? '';
  const messages = trimmed.length > 0
    ? allMessages.filter(m =>
        m.content.toLowerCase().includes(trimmed)
        || m.authorDisplayName.toLowerCase().includes(trimmed)
        || m.authorTag.toLowerCase().includes(trimmed))
    : allMessages;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pendingNew, setPendingNew] = useState(0);
  const previousLength = useRef(0);
  const justSwitchedRef = useRef(true);
  const anchorRef = useRef<{ id: string; top: number } | null>(null);

  // Re-pin to bottom when content height grows after the initial scroll
  // (images/attachments loading, embeds expanding). If the user is reading
  // older messages we leave the position alone.
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const ro = new ResizeObserver(() => {
      if (anchorRef.current) return;
      if (justSwitchedRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
        return;
      }
      const nearBottom = scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight) < 120;
      if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  // Jump to a specific message: scroll its row into view and apply a
  // short-lived highlight class. If the row isn't in the DOM (loaded from
  // older history we don't have), we silently noop — extending to fetch
  // older pages is a follow-up.
  useEffect(() => {
    if (!jumpToMessageId) return;
    const el = scrollRef.current;
    if (!el) return;
    const target = el.querySelector(`[data-message-id="${jumpToMessageId}"]`) as HTMLElement | null;
    if (!target) { onJumpComplete?.(); return; }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('bc-jump-flash');
    const t = window.setTimeout(() => {
      target.classList.remove('bc-jump-flash');
      onJumpComplete?.();
    }, 1600);
    return () => window.clearTimeout(t);
  }, [jumpToMessageId, onJumpComplete]);

  // Reset on channel switch. We keep `justSwitchedRef` true for a window
  // (~800ms) so that async-loaded content (images, embeds, the forum-post
  // header, etc.) keeps re-pinning to the bottom while it's still settling
  // — otherwise the user lands above the latest message and has to scroll.
  useEffect(() => {
    justSwitchedRef.current = true;
    setPendingNew(0);
    previousLength.current = 0;
    const t = window.setTimeout(() => { justSwitchedRef.current = false; }, 800);
    return () => window.clearTimeout(t);
  }, [channelId]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Anchor preservation for loadOlder prepends takes priority.
    if (anchorRef.current) {
      const target = el.querySelector(`[data-message-id="${anchorRef.current.id}"]`) as HTMLElement | null;
      if (target) {
        const newTop = target.getBoundingClientRect().top;
        el.scrollTop += (newTop - anchorRef.current.top);
      }
      anchorRef.current = null;
      previousLength.current = messages.length;
      return;
    }

    // While we're still in the post-switch settle window, keep pinning to
    // the bottom on every render. The timeout in the channel-switch effect
    // clears the flag once content has had time to settle.
    if (justSwitchedRef.current) {
      el.scrollTop = el.scrollHeight;
      previousLength.current = messages.length;
      return;
    }

    // New live messages. If the latest one is from our bot (i.e. we just
    // sent it), always smooth-scroll to it so the user sees their own
    // message animate into view. Otherwise keep the existing "near bottom"
    // pin and surface a pending-new pill when the user is reading older.
    if (messages.length > previousLength.current) {
      const newCount = messages.length - previousLength.current;
      const last = messages[messages.length - 1];
      const fromBot = bot && last?.authorId === bot.id;
      if (fromBot) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        setPendingNew(0);
      } else {
        const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 100;
        if (nearBottom) el.scrollTop = el.scrollHeight;
        else setPendingNew(p => p + newCount);
      }
    }
    previousLength.current = messages.length;
  }, [messages, channelId]);

  const onScroll = async () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 200 && hasMore && !loading && messages.length > 0) {
      const oldest = messages[0]!;
      const target = el.querySelector(`[data-message-id="${oldest.id}"]`) as HTMLElement | null;
      if (target) anchorRef.current = { id: oldest.id, top: target.getBoundingClientRect().top };
      await loadOlder();
    }
    if (el.scrollHeight - (el.scrollTop + el.clientHeight) < 100) {
      setPendingNew(0);
    }
  };

  if (!channelId) return <div className="flex-1 flex items-center justify-center text-fg-muted">Select a channel</div>;

  const groups = groupMessages(messages);

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div ref={contentRef}>
          {header}
          {error && <div className="p-3 text-danger text-sm">{error}</div>}
          {loading && messages.length === 0 && <MessageSkeleton count={6} />}
          {!hasMore && messages.length > 0 && (
            <div className="text-center text-[10px] text-fg-muted py-2">— Beginning of channel history —</div>
          )}
          {messages.length > 0 && (
            <div key={channelId} className="animate-fade-in">
              {renderGroupsWithDateSeparators(groups, onReply)}
            </div>
          )}
        </div>
      </div>
      {pendingNew > 0 && (
        <button
          className="absolute bottom-3 right-4 px-3 py-1 bg-accent text-white rounded-full text-xs shadow-lg hover:bg-accent-hover animate-fade-in-up transition-colors"
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            setPendingNew(0);
          }}
        >
          ↓ Jump to present ({pendingNew} new)
        </button>
      )}
    </div>
  );
}
