import type { MessageSummary } from '../../shared/domain';
import { MessageContent } from './MessageContent';

export function MessageGroup({ messages }: { messages: MessageSummary[] }) {
  if (messages.length === 0) return null;
  const head = messages[0]!;
  const ts = new Date(head.createdAt).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
  return (
    <div className="px-4 py-1 hover:bg-bg-subtle/30 group flex gap-3">
      <div className="w-10 shrink-0">
        {head.authorAvatarUrl
          ? <img src={head.authorAvatarUrl} alt="" className="w-10 h-10 rounded-full" />
          : <div className="w-10 h-10 rounded-full bg-border flex items-center justify-center text-xs">{head.authorTag.slice(0, 2).toUpperCase()}</div>}
      </div>
      <div className="flex-1 min-w-0">
        <div data-message-id={head.id}>
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-fg">{head.authorTag}</span>
            <span className="text-[10px] text-fg-muted">{ts}</span>
          </div>
          <MessageContent message={head} />
        </div>
        {messages.slice(1).map(m => (
          <div key={m.id} data-message-id={m.id} className="mt-1">
            <MessageContent message={m} />
          </div>
        ))}
      </div>
    </div>
  );
}
