import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MessageSummary } from '../../shared/domain';
import { useChannelMessages } from '../lib/use-channel-messages';
import { MessageGroup } from './MessageGroup';
import { SystemMessageRow } from './SystemMessageRow';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function groupMessages(messages: MessageSummary[]): MessageSummary[][] {
  const groups: MessageSummary[][] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    const canGroup = prev
      && !prev.systemKind
      && !m.systemKind
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

export function MessageList({ channelId }: { channelId: string | null }) {
  const { messages, loading, hasMore, loadOlder, error } = useChannelMessages(channelId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pendingNew, setPendingNew] = useState(0);
  const previousLength = useRef(0);
  const previousChannelId = useRef<string | null>(null);
  const anchorRef = useRef<{ id: string; top: number } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (previousChannelId.current !== channelId) {
      previousChannelId.current = channelId;
      setPendingNew(0);
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
      previousLength.current = messages.length;
      return;
    }

    if (messages.length > previousLength.current) {
      const newCount = messages.length - previousLength.current;
      const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 100;
      if (nearBottom) {
        requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
      } else if (anchorRef.current === null) {
        setPendingNew(p => p + newCount);
      }
    }
    previousLength.current = messages.length;
  }, [messages, channelId]);

  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const target = el.querySelector(`[data-message-id="${anchorRef.current.id}"]`) as HTMLElement | null;
    if (target) {
      const newTop = target.getBoundingClientRect().top;
      el.scrollTop += (newTop - anchorRef.current.top);
    }
    anchorRef.current = null;
  }, [messages]);

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
        {error && <div className="p-3 text-danger text-sm">{error}</div>}
        {loading && messages.length === 0 && <div className="p-3 text-fg-muted text-sm">Loading…</div>}
        {!hasMore && messages.length > 0 && (
          <div className="text-center text-[10px] text-fg-muted py-2">— Beginning of channel history —</div>
        )}
        {groups.map((g, gi) => {
          const head = g[0]!;
          if (head.systemKind) return <SystemMessageRow key={`s-${gi}-${head.id}`} message={head} />;
          return <MessageGroup key={`g-${gi}-${head.id}`} messages={g} />;
        })}
      </div>
      {pendingNew > 0 && (
        <button
          className="absolute bottom-3 right-4 px-3 py-1 bg-accent text-white rounded-full text-xs shadow-lg hover:bg-accent-hover"
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
            setPendingNew(0);
          }}
        >
          ↓ Jump to present ({pendingNew} new)
        </button>
      )}
    </div>
  );
}
