import { useEffect, useState } from 'react';
import type { PollSummary, PollVoter, ResolvedMention } from '../../shared/domain';
import { toTwemojiUrl } from '../lib/twemoji';
import { Markdown } from './Markdown';
import { IconChartBar, IconX } from '@tabler/icons-react';
import { api } from '../lib/api';

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

export function PollCard({ poll, channelId, messageId, mentions }: { poll: PollSummary; channelId: string; messageId: string; mentions?: ResolvedMention[] }) {
  const winningCount = Math.max(0, ...poll.answers.map(a => a.voteCount));
  const [openAnswer, setOpenAnswer] = useState<number | null>(null);
  // Per-answer voter cache so hover preview and modal share data.
  const [voters, setVoters] = useState<Map<number, PollVoter[]>>(new Map());
  const [loading, setLoading] = useState<Set<number>>(new Set());

  const ensureVoters = (answerId: number) => {
    if (voters.has(answerId) || loading.has(answerId)) return;
    setLoading(prev => new Set(prev).add(answerId));
    api.messages.fetchPollVoters(channelId, messageId, answerId).then(res => {
      setLoading(prev => {
        const next = new Set(prev);
        next.delete(answerId);
        return next;
      });
      if (res.ok) {
        setVoters(prev => new Map(prev).set(answerId, res.data));
      }
    });
  };

  return (
    <div className="my-2 max-w-[520px] rounded-lg bg-bg-subtle border border-white/[0.06] p-4">
      <div className="text-[11px] uppercase font-semibold text-fg-dim mb-2 flex items-center gap-1">
        <IconChartBar size={14} stroke={2} /> Poll
      </div>
      <div className="text-[16px] font-semibold text-fg mb-3 leading-snug">
        <Markdown source={poll.question} mentions={mentions ?? []} jumbo={false} />
      </div>
      <div className="space-y-1.5">
        {poll.answers.map(a => {
          const pct = poll.totalVotes > 0 ? Math.round((a.voteCount / poll.totalVotes) * 100) : 0;
          const isWinning = a.voteCount > 0 && a.voteCount === winningCount;
          const cachedVoters = voters.get(a.id);
          return (
            <PollAnswerRow
              key={a.id}
              text={a.text}
              emoji={a.emoji}
              voteCount={a.voteCount}
              pct={pct}
              isWinning={isWinning}
              voters={cachedVoters}
              mentions={mentions ?? []}
              onHover={() => { if (a.voteCount > 0) ensureVoters(a.id); }}
              onOpen={() => { if (a.voteCount > 0) { ensureVoters(a.id); setOpenAnswer(a.id); } }}
            />
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-fg-dim">
        <span>{poll.totalVotes} {poll.totalVotes === 1 ? 'vote' : 'votes'}{poll.allowMultiselect ? ' · multiple choice' : ''}</span>
        {poll.expiresAt && <span>{formatRemaining(poll.expiresAt, poll.resultsFinalized)}</span>}
      </div>
      {openAnswer !== null && (
        <PollVotersModal
          poll={poll}
          channelId={channelId}
          messageId={messageId}
          initialAnswerId={openAnswer}
          voters={voters}
          loading={loading}
          ensureVoters={ensureVoters}
          onClose={() => setOpenAnswer(null)}
        />
      )}
    </div>
  );
}

// One answer row + a cursor-anchored hover preview that floats above the
// mouse. We use position: fixed (escapes any ancestor overflow) and update
// on mouse move so the chip tracks smoothly. Hidden until we have voters
// cached for the answer.
function PollAnswerRow({
  text, emoji, voteCount, pct, isWinning, voters, mentions, onHover, onOpen,
}: {
  text: string;
  emoji: string | null;
  voteCount: number;
  pct: number;
  isWinning: boolean;
  voters: PollVoter[] | undefined;
  mentions?: ResolvedMention[];
  onHover: () => void;
  onOpen: () => void;
}) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const showPreview = voteCount > 0 && cursor !== null && voters && voters.length > 0;

  return (
    <div className="relative">
      <button
        onMouseEnter={onHover}
        onMouseMove={(e) => { if (voteCount > 0) setCursor({ x: e.clientX, y: e.clientY }); }}
        onMouseLeave={() => setCursor(null)}
        onClick={onOpen}
        disabled={voteCount === 0}
        className="block w-full text-left bg-bg-input rounded overflow-hidden disabled:cursor-default enabled:hover:bg-hover"
      >
        <div
          className={`absolute inset-y-0 left-0 ${isWinning ? 'bg-accent/40' : 'bg-hover'}`}
          style={{ width: `${pct}%` }}
        />
        <div className="relative flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="flex items-center gap-2 truncate">
            {emoji && <EmojiBit token={emoji} />}
            <Markdown source={text} mentions={mentions ?? []} jumbo={false} />
          </span>
          <span className="text-fg-muted text-xs shrink-0 tabular-nums">{voteCount} · {pct}%</span>
        </div>
      </button>
      {showPreview && (
        <div
          className="fixed z-50 flex items-center gap-2 px-2.5 py-1.5 bg-bg-sunken border border-white/[0.08] rounded-md shadow-xl text-[12px] text-fg-muted pointer-events-none animate-fade-in whitespace-nowrap max-w-[320px]"
          style={{
            left: cursor!.x,
            top: cursor!.y - 12,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="flex -space-x-1.5 shrink-0">
            {voters!.slice(0, 5).map(v => (
              <img
                key={v.id}
                src={v.avatarUrl ?? ''}
                alt=""
                title={v.displayName}
                className="w-5 h-5 rounded-full border-2 border-bg-sunken"
              />
            ))}
          </div>
          <span className="truncate text-fg">
            {voters!.slice(0, 2).map(v => v.displayName).join(', ')}
            {voters!.length > 2 && (
              <span className="text-fg-muted">
                {` +${voters!.length - 2} ${voters!.length - 2 === 1 ? 'other' : 'others'}`}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function PollVotersModal({
  poll, initialAnswerId, voters, loading, ensureVoters, onClose,
}: {
  poll: PollSummary;
  channelId: string;
  messageId: string;
  initialAnswerId: number;
  voters: Map<number, PollVoter[]>;
  loading: Set<number>;
  ensureVoters: (id: number) => void;
  onClose: () => void;
}) {
  const [activeAnswerId, setActiveAnswerId] = useState(initialAnswerId);
  useEffect(() => { ensureVoters(activeAnswerId); }, [activeAnswerId, ensureVoters]);

  const activeAnswer = poll.answers.find(a => a.id === activeAnswerId);
  const list = voters.get(activeAnswerId) ?? [];
  const isLoading = loading.has(activeAnswerId);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-bg-subtle border border-white/[0.06] rounded-lg w-[28rem] max-w-[90vw] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase font-semibold text-fg-dim">Poll votes</div>
            <div className="text-fg font-semibold truncate">{poll.question}</div>
          </div>
          <button className="text-fg-muted hover:text-fg shrink-0" onClick={onClose} title="Close">
            <IconX size={18} stroke={2} />
          </button>
        </div>
        <div className="flex border-b border-white/[0.06] overflow-x-auto">
          {poll.answers.map(a => (
            <button
              key={a.id}
              onClick={() => setActiveAnswerId(a.id)}
              className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 ${a.id === activeAnswerId ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}
            >
              {a.text} · {a.voteCount}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {isLoading && list.length === 0 && (
            <div className="text-fg-dim text-sm px-4 py-6 text-center">Loading voters…</div>
          )}
          {!isLoading && list.length === 0 && (
            <div className="text-fg-dim text-sm px-4 py-6 text-center">{activeAnswer?.voteCount ? 'No data' : 'No votes yet'}</div>
          )}
          {list.map(v => (
            <div key={v.id} className="flex items-center gap-3 px-4 py-1.5 hover:bg-hover">
              {v.avatarUrl
                ? <img src={v.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
                : <div className="w-8 h-8 rounded-full bg-bg-input" />}
              <div className="min-w-0">
                <div
                  className="text-sm font-medium truncate"
                  style={v.roleColor ? { color: v.roleColor } : undefined}
                >
                  {v.displayName}
                </div>
                <div className="text-fg-dim text-xs truncate">@{v.username}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmojiBit({ token }: { token: string }) {
  const m = /^<(a?):([A-Za-z0-9_]+):(\d+)>$/.exec(token);
  if (m) {
    const ext = m[1] === 'a' ? 'gif' : 'png';
    return <img src={`https://cdn.discordapp.com/emojis/${m[3]}.${ext}`} alt="" className="inline-block w-5 h-5" />;
  }
  return <img src={toTwemojiUrl(token)} alt={token} draggable={false} className="inline-block w-5 h-5 select-none" />;
}
