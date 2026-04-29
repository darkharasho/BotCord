import type { PollSummary } from '../../shared/domain';
import { Markdown } from './Markdown';
import { IconChartBar } from '@tabler/icons-react';

function formatRemaining(expiresAt: number, finalized: boolean): string {
  if (finalized) return 'Final results';
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'Closed';
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d left`;
  if (hours > 0) return `${hours}h left`;
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  return `${minutes}m left`;
}

export function PollCard({ poll }: { poll: PollSummary }) {
  const winningCount = Math.max(0, ...poll.answers.map(a => a.voteCount));
  return (
    <div className="my-2 max-w-[520px] rounded-lg bg-bg-subtle border border-white/[0.06] p-4">
      <div className="text-[11px] uppercase font-semibold text-fg-dim mb-2 flex items-center gap-1">
        <IconChartBar size={14} stroke={2} /> Poll
      </div>
      <div className="text-[16px] font-semibold text-fg mb-3 leading-snug">{poll.question}</div>
      <div className="space-y-1.5">
        {poll.answers.map(a => {
          const pct = poll.totalVotes > 0 ? Math.round((a.voteCount / poll.totalVotes) * 100) : 0;
          const isWinning = a.voteCount > 0 && a.voteCount === winningCount;
          return (
            <div key={a.id} className="relative bg-bg-input rounded overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 ${isWinning ? 'bg-accent/40' : 'bg-hover'}`}
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex items-center gap-2 truncate">
                  {a.emoji && <EmojiBit token={a.emoji} />}
                  <Markdown source={a.text} />
                </span>
                <span className="text-fg-muted text-xs shrink-0 tabular-nums">{a.voteCount} · {pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-fg-dim">
        <span>{poll.totalVotes} {poll.totalVotes === 1 ? 'vote' : 'votes'}{poll.allowMultiselect ? ' · multiple choice' : ''}</span>
        {poll.expiresAt && <span>{formatRemaining(poll.expiresAt, poll.resultsFinalized)}</span>}
      </div>
    </div>
  );
}

function EmojiBit({ token }: { token: string }) {
  // Reuse the same custom-emoji format as our markdown for guild emoji.
  const m = /^<(a?):([A-Za-z0-9_]+):(\d+)>$/.exec(token);
  if (m) {
    const ext = m[1] === 'a' ? 'gif' : 'png';
    return <img src={`https://cdn.discordapp.com/emojis/${m[3]}.${ext}`} alt="" className="inline-block w-5 h-5" />;
  }
  return <span className="inline-block">{token}</span>;
}
