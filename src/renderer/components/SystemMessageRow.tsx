import type { MessageSummary, SystemMessageKind } from '../../shared/domain';
import {
  IconArrowRight,
  IconPin,
  IconRocket,
  IconMessages,
  IconRss,
  IconUserPlus,
  IconInfoCircle,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';

const ICONS: Record<SystemMessageKind, Icon> = {
  user_join: IconArrowRight,
  pin: IconPin,
  boost: IconRocket,
  thread_create: IconMessages,
  channel_follow: IconRss,
  recipient_add: IconUserPlus,
  other: IconInfoCircle,
};

const ACCENTS: Record<SystemMessageKind, string> = {
  user_join: 'text-ok',
  pin: 'text-fg-muted',
  boost: 'text-accent',
  thread_create: 'text-fg-muted',
  channel_follow: 'text-fg-muted',
  recipient_add: 'text-ok',
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
    case 'other': return message.content || 'System message';
    default: return '';
  }
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
        <span>{describe(message)}</span>
        <span className="text-[11px] text-fg-dim ml-2">{formatTimestamp(message.createdAt)}</span>
      </div>
    </div>
  );
}
