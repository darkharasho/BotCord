import type { MessageSummary } from '../../shared/domain';
import { MessageContent } from './MessageContent';
import { IconCornerUpLeft, IconCornerDownRight } from '@tabler/icons-react';
import { useBotIdentity } from '../lib/use-bot-identity';

function mentionsBot(m: MessageSummary, botId: string | undefined): boolean {
  if (!botId) return false;
  return m.mentions.some(x => x.type === 'user' && x.id === botId);
}

const MENTION_ROW = 'before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-warn bg-warn/[0.06] hover:bg-warn/[0.10]';

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

export function MessageGroup({ messages, onReply }: { messages: MessageSummary[]; onReply?: ((m: MessageSummary) => void) | undefined }) {
  if (messages.length === 0) return null;
  const head = messages[0]!;
  const bot = useBotIdentity();
  const headHighlight = mentionsBot(head, bot?.id) ? MENTION_ROW : 'hover:bg-hover/40';
  return (
    <div className="mt-4 first:mt-2 px-4">
      {head.replyTo && <ReplyPreview replyTo={head.replyTo} />}
      <div className={`relative flex gap-4 -mx-4 px-4 py-0.5 group ${headHighlight}`}>
        <HoverActions message={head} onReply={onReply} />
        <div className="w-10 shrink-0 pt-0.5">
          {head.authorAvatarUrl
            ? <img src={head.authorAvatarUrl} alt="" className="w-10 h-10 rounded-full" />
            : <div className="w-10 h-10 rounded-full bg-bg-input flex items-center justify-center text-xs font-semibold text-fg">{head.authorDisplayName.slice(0, 2).toUpperCase()}</div>}
        </div>
        <div className="flex-1 min-w-0">
          <div data-message-id={head.id}>
            <div className="flex items-baseline gap-2 whitespace-nowrap">
              <span
                className="font-medium text-[15px] truncate cursor-default"
                style={head.authorRoleColor ? { color: head.authorRoleColor } : undefined}
                title={head.authorTopRoleName ? `@${head.authorTag} · ${head.authorTopRoleName}` : `@${head.authorTag}`}
              >{head.authorDisplayName}</span>
              <span className="text-[11px] text-fg-dim shrink-0">{formatHeaderTimestamp(head.createdAt)}</span>
            </div>
            <MessageContent message={head} />
          </div>
        </div>
      </div>
      {messages.slice(1).map(m => (
        <div
          key={m.id}
          data-message-id={m.id}
          className={`relative flex gap-4 -mx-4 px-4 py-0.5 group ${mentionsBot(m, bot?.id) ? MENTION_ROW : 'hover:bg-hover/40'}`}
        >
          <HoverActions message={m} onReply={onReply} />
          <div className="w-10 shrink-0 text-[10px] text-fg-dim text-right pr-1 opacity-0 group-hover:opacity-100 leading-[21px] whitespace-nowrap tracking-tight">
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

function ReplyPreview({ replyTo }: { replyTo: NonNullable<MessageSummary['replyTo']> }) {
  return (
    <div className="flex items-center gap-2 -mx-4 pl-12 pr-4 mb-0.5 text-[13px] text-fg-muted overflow-hidden">
      <IconCornerDownRight size={14} stroke={2} className="text-fg-dim shrink-0" />
      {replyTo.authorAvatarUrl && (
        <img src={replyTo.authorAvatarUrl} alt="" className="w-4 h-4 rounded-full shrink-0" />
      )}
      <span
        className="font-medium shrink-0 truncate max-w-[12rem]"
        style={replyTo.authorRoleColor ? { color: replyTo.authorRoleColor } : undefined}
      >
        @{replyTo.authorDisplayName ?? 'unknown'}
      </span>
      <span className="text-fg-dim truncate min-w-0">
        {replyTo.content?.split('\n')[0]?.slice(0, 200) || (replyTo.authorDisplayName ? '' : 'Original message')}
      </span>
    </div>
  );
}

function HoverActions({ message, onReply }: { message: MessageSummary; onReply?: ((m: MessageSummary) => void) | undefined }) {
  if (!onReply) return null;
  return (
    <div className="absolute -top-3 right-4 opacity-0 group-hover:opacity-100 z-10 bg-bg-subtle border border-white/[0.06] rounded shadow-lg flex">
      <button
        onClick={() => onReply(message)}
        className="w-8 h-8 flex items-center justify-center text-fg-muted hover:text-fg hover:bg-hover rounded"
        title="Reply"
      >
        <IconCornerUpLeft size={18} stroke={1.75} />
      </button>
    </div>
  );
}
