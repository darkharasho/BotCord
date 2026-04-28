import type { MessageSummary } from '../../shared/domain';
import { MessageContent } from './MessageContent';

function formatHeaderTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const wasYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today at ${time}`;
  if (wasYesterday) return `Yesterday at ${time}`;
  return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' }) + ' ' + time;
}

function formatGutterTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function MessageGroup({ messages }: { messages: MessageSummary[] }) {
  if (messages.length === 0) return null;
  const head = messages[0]!;
  return (
    <div className="mt-4 first:mt-2 px-4">
      <div className="flex gap-4 -mx-4 px-4 py-0.5 hover:bg-hover/40 group">
        <div className="w-10 shrink-0 pt-0.5">
          {head.authorAvatarUrl
            ? <img src={head.authorAvatarUrl} alt="" className="w-10 h-10 rounded-full" />
            : <div className="w-10 h-10 rounded-full bg-bg-input flex items-center justify-center text-xs font-semibold text-fg">{head.authorTag.slice(0, 2).toUpperCase()}</div>}
        </div>
        <div className="flex-1 min-w-0">
          <div data-message-id={head.id}>
            <div className="flex items-baseline gap-2 leading-none">
              <span className="font-medium text-fg text-[15px]">{head.authorTag}</span>
              <span className="text-[11px] text-fg-dim">{formatHeaderTimestamp(head.createdAt)}</span>
            </div>
            <MessageContent message={head} />
          </div>
        </div>
      </div>
      {messages.slice(1).map(m => (
        <div
          key={m.id}
          data-message-id={m.id}
          className="flex gap-4 -mx-4 px-4 py-0.5 hover:bg-hover/40 group"
        >
          <div className="w-10 shrink-0 text-[10px] text-fg-dim text-right pr-1 opacity-0 group-hover:opacity-100 leading-6">
            {formatGutterTimestamp(m.createdAt)}
          </div>
          <div className="flex-1 min-w-0">
            <MessageContent message={m} />
          </div>
        </div>
      ))}
    </div>
  );
}
