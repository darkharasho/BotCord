import { useEffect, useState } from 'react';
import { IconPinned, IconX } from '@tabler/icons-react';
import { api } from '../lib/api';
import type { MessageSummary } from '../../shared/domain';
import { MessageContent } from './MessageContent';
import { pushToast } from './Toaster';

// Header dropdown that fetches the channel's pinned messages on open and
// renders each as a Discord-style mini-message card. Hovering a card
// reveals a Jump button (scrolls the main feed to the message + flashes
// it) and an X button (unpins it).
export function PinnedMessagesPopover({
  channelId, onClose, onJump,
}: {
  channelId: string;
  onClose: () => void;
  onJump?: (messageId: string) => void;
}) {
  const [messages, setMessages] = useState<MessageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.messages.listPinned(channelId).then(res => {
      if (!active) return;
      if (res.ok) setMessages(res.data);
      else setError(res.error.message);
    });
    return () => { active = false; };
  }, [channelId]);

  const handleUnpin = async (id: string) => {
    const res = await api.messages.unpin(channelId, id);
    if (!res.ok) { pushToast('danger', `Couldn't unpin: ${res.error.message}`); return; }
    pushToast('ok', 'Message unpinned');
    setMessages(prev => prev ? prev.filter(m => m.id !== id) : prev);
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full right-0 mt-2 z-50 w-[460px] max-w-[92vw] bg-bg-subtle border border-white/[0.08] rounded-lg shadow-2xl flex flex-col animate-fade-in-down origin-top-right overflow-hidden">
        <div className="px-4 py-3.5 flex items-center gap-2 border-b border-white/[0.06]">
          <IconPinned size={20} stroke={2} className="text-fg" />
          <span className="text-[16px] font-bold text-fg">Pinned Messages</span>
        </div>

        <div className="max-h-[520px] overflow-y-auto p-3 space-y-2">
          {error && <div className="p-3 text-danger text-sm">{error}</div>}
          {messages === null && !error && (
            <div className="p-4 text-fg-muted text-sm text-center">Loading…</div>
          )}
          {messages && messages.length === 0 && (
            <div className="px-2 py-10 text-center">
              <IconPinned size={36} stroke={1.25} className="text-fg-dim mx-auto mb-3" />
              <div className="text-fg-muted text-sm">No pinned messages yet.</div>
              <div className="text-fg-dim text-[12px] mt-1">Important messages will appear here.</div>
            </div>
          )}
          {messages && messages.map(m => (
            <PinnedCard
              key={m.id}
              message={m}
              onJump={() => onJump?.(m.id)}
              onUnpin={() => void handleUnpin(m.id)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function PinnedCard({
  message, onJump, onUnpin,
}: {
  message: MessageSummary;
  onJump: () => void;
  onUnpin: () => void;
}) {
  return (
    <div
      className="group relative bg-bg-input border border-white/[0.08] hover:border-white/[0.16] rounded-md px-3 py-2.5 transition-colors duration-150"
    >
      <div className="flex items-start gap-3">
        {message.authorAvatarUrl
          ? <img src={message.authorAvatarUrl} alt="" className="w-8 h-8 rounded-full shrink-0" />
          : <div className="w-8 h-8 rounded-full bg-bg-input shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 pr-[100px]">
            <span
              className="text-[14px] font-semibold truncate"
              style={message.authorRoleColor ? { color: message.authorRoleColor } : undefined}
            >
              {message.authorDisplayName}
            </span>
            {message.authorIsBot && (
              <span className="px-1 py-px rounded text-[10px] font-bold leading-none bg-accent text-white tracking-wide shrink-0">
                APP
              </span>
            )}
            <span className="text-[11px] text-fg-dim shrink-0 ml-0.5">
              {formatPinnedTimestamp(message.createdAt)}
            </span>
          </div>
          <div className="text-[14px] text-fg leading-snug">
            <MessageContent message={message} />
          </div>
        </div>
      </div>

      {/* Hover actions — Jump + Unpin. */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center gap-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); onJump(); }}
          className="px-2.5 py-1 text-[12px] font-medium rounded bg-bg-sunken border border-white/[0.10] text-fg hover:bg-hover transition-colors"
          title="Jump to message"
        >
          Jump
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onUnpin(); }}
          className="w-7 h-7 flex items-center justify-center rounded bg-bg-sunken border border-white/[0.10] text-fg-muted hover:text-danger hover:bg-danger/10 hover:border-danger/30 transition-colors"
          title="Unpin"
        >
          <IconX size={14} stroke={2} />
        </button>
      </div>
    </div>
  );
}

function formatPinnedTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: '2-digit' });
}
