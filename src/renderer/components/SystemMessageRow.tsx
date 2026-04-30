import type { MessageSummary, SystemMessageKind } from '../../shared/domain';
import {
  IconArrowRight,
  IconPin,
  IconRocket,
  IconMessages,
  IconRss,
  IconUserPlus,
  IconInfoCircle,
  IconChartBar,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { TwemojiOne } from '../lib/twemoji';

const ICONS: Record<SystemMessageKind, Icon> = {
  user_join: IconArrowRight,
  pin: IconPin,
  boost: IconRocket,
  thread_create: IconMessages,
  channel_follow: IconRss,
  recipient_add: IconUserPlus,
  poll_result: IconChartBar,
  other: IconInfoCircle,
};

const ACCENTS: Record<SystemMessageKind, string> = {
  user_join: 'text-ok',
  pin: 'text-fg-muted',
  boost: 'text-accent',
  thread_create: 'text-fg-muted',
  channel_follow: 'text-fg-muted',
  recipient_add: 'text-ok',
  poll_result: 'text-accent',
  other: 'text-fg-muted',
};

function describe(message: MessageSummary): string {
  const who = message.authorDisplayName || message.authorTag || 'Someone';
  switch (message.systemKind) {
    case 'user_join': return `${who} joined the server.`;
    case 'pin': return `${who} pinned a message to this channel.`;
    case 'boost': return `${who} just boosted the server!`;
    case 'thread_create': return `${who} started a thread${message.content ? `: ${message.content}` : ''}`;
    case 'channel_follow': return `${who} has added an announcement channel to this channel.`;
    case 'recipient_add': return `${who} was added.`;
    case 'poll_result': return `${who}'s poll has closed.`;
    case 'other': return message.content || 'System message';
    default: return '';
  }
}

function EmojiBit({ token }: { token: string }) {
  const m = /^<(a?):([A-Za-z0-9_]+):(\d+)>$/.exec(token);
  if (m) {
    const ext = m[1] === 'a' ? 'gif' : 'png';
    return <img src={`https://cdn.discordapp.com/emojis/${m[3]}.${ext}`} alt="" className="inline-block w-4 h-4 align-text-bottom" />;
  }
  return <TwemojiOne char={token} className="inline-block w-4 h-4 align-text-bottom select-none" fallbackClassName="inline-block w-4 h-4 leading-none text-[14px]" />;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function SystemMessageRow({ message }: { message: MessageSummary }) {
  if (!message.systemKind) return null;
  const Glyph = ICONS[message.systemKind];
  const color = ACCENTS[message.systemKind];
  return (
    <div
      data-message-id={message.id}
      className="flex items-baseline gap-3 px-4 py-0.5 hover:bg-hover/40 group"
    >
      <div className="w-10 shrink-0 flex justify-end pr-0.5">
        <Glyph size={16} stroke={2} className={`${color} self-center`} />
      </div>
      <div className="flex-1 min-w-0 text-[14px] leading-[1.375] text-fg-muted">
        <span>
          {message.systemKind === 'poll_result' && message.pollResult?.question
            ? <>{message.authorDisplayName || message.authorTag || 'Someone'}{`'s poll `}<span className="text-fg">{message.pollResult.question}</span>{` has closed.`}</>
            : describe(message)}
        </span>
        <span className="text-[11px] text-fg-dim ml-2">{formatTimestamp(message.createdAt)}</span>
        {message.systemKind === 'poll_result' && message.pollResult && (
          <PollResultPanel result={message.pollResult} />
        )}
      </div>
    </div>
  );
}

function PollResultPanel({ result }: { result: NonNullable<MessageSummary['pollResult']> }) {
  const pct = result.totalVotes > 0
    ? Math.round((result.victorAnswerVotes / result.totalVotes) * 100)
    : 0;
  return (
    <div className="mt-1.5 max-w-[420px] rounded-md bg-bg-subtle border border-white/[0.06] px-3 py-2 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        {result.tied ? (
          <div className="text-fg text-sm font-medium">The results were tied</div>
        ) : (
          <div className="text-fg text-sm font-medium truncate flex items-center gap-1.5">
            {result.victorAnswerEmoji && <EmojiBit token={result.victorAnswerEmoji} />}
            <span className="truncate">{result.victorAnswerText ?? 'Winner'}</span>
          </div>
        )}
        <div className="text-fg-dim text-xs tabular-nums">
          {result.victorAnswerVotes} of {result.totalVotes} {result.totalVotes === 1 ? 'vote' : 'votes'} · {pct}%
        </div>
      </div>
    </div>
  );
}
