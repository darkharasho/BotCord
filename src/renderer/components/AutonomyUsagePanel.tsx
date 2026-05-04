import { useCallback, useEffect, useState } from 'react';
import type {
  AutonomyUsageStatsView,
  AutonomyUsageTotalsByKind,
  AutonomyGuildUsageView,
} from '../../shared/ipc-contract';

const REFRESH_MS = 30_000;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return n.toLocaleString('en-US');
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function isEmpty(s: AutonomyUsageStatsView): boolean {
  return s.lifetime.combined.runCount === 0 && s.perGuild.length === 0;
}

function TotalsColumn({ title, totals }: { title: string; totals: AutonomyUsageTotalsByKind }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-text-muted mb-2">{title}</h4>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between"><dt className="text-text-muted">Input</dt><dd>{formatTokens(totals.combined.inputTokens)}</dd></div>
        <div className="flex justify-between"><dt className="text-text-muted">Output</dt><dd>{formatTokens(totals.combined.outputTokens)}</dd></div>
        <div className="flex justify-between"><dt className="text-text-muted">Cache</dt><dd>{formatTokens(totals.combined.cacheReadTokens)} read / {formatTokens(totals.combined.cacheCreationTokens)} written</dd></div>
        <div className="flex justify-between"><dt className="text-text-muted">Runs</dt><dd>{totals.combined.runCount.toLocaleString('en-US')}</dd></div>
        <div className="flex justify-between"><dt className="text-text-muted">Cost</dt><dd>{formatCost(totals.combined.costUsd)}</dd></div>
      </dl>
      <div className="mt-2 text-xs text-text-muted">
        auto: {totals.autonomous.runCount} runs · draft: {totals.draft.runCount} runs
      </div>
    </div>
  );
}

function GuildRow({ g }: { g: AutonomyGuildUsageView }) {
  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-4">
        <div>{g.guildName}</div>
        <div className="text-xs text-text-muted">auto {g.lifetime.autonomous.runCount} · draft {g.lifetime.draft.runCount}</div>
      </td>
      <td className="py-2 pr-4 tabular-nums">{g.last7d.combined.runCount} / {g.lifetime.combined.runCount}</td>
      <td className="py-2 pr-4 tabular-nums">{formatTokens(g.last7d.combined.inputTokens)} / {formatTokens(g.lifetime.combined.inputTokens)}</td>
      <td className="py-2 pr-4 tabular-nums">{formatTokens(g.last7d.combined.outputTokens)} / {formatTokens(g.lifetime.combined.outputTokens)}</td>
      <td className="py-2 pr-4 tabular-nums">{formatCost(g.last7d.combined.costUsd)} / {formatCost(g.lifetime.combined.costUsd)}</td>
    </tr>
  );
}

export function AutonomyUsagePanel() {
  const [stats, setStats] = useState<AutonomyUsageStatsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await window.botcord.autonomy.getUsageStats();
    if (res.ok) {
      setStats(res.data);
      setError(null);
    } else {
      setError(res.error?.message ?? 'Failed to load usage stats');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (error) {
    return (
      <div className="text-sm text-text-muted">
        <p className="text-red-400 mb-2">Couldn't load usage: {error}</p>
        <button
          type="button"
          className="px-3 py-1 rounded border border-border hover:bg-bg-hover"
          onClick={() => void load()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!stats) return <div className="text-sm text-text-muted">Loading…</div>;

  if (isEmpty(stats)) {
    return <div className="text-sm text-text-muted">No autonomy usage recorded yet.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <TotalsColumn title="Last 7 days" totals={stats.last7d} />
        <TotalsColumn title="Lifetime" totals={stats.lifetime} />
      </div>
      <p className="text-xs text-text-muted">Cost reflects API billing; subscription users will see $0.</p>

      {stats.perGuild.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-text-muted">
              <tr className="text-left">
                <th className="py-2 pr-4 font-normal">Server</th>
                <th className="py-2 pr-4 font-normal">Runs (7d / lifetime)</th>
                <th className="py-2 pr-4 font-normal">Tokens in (7d / lifetime)</th>
                <th className="py-2 pr-4 font-normal">Tokens out (7d / lifetime)</th>
                <th className="py-2 pr-4 font-normal">Cost (7d / lifetime)</th>
              </tr>
            </thead>
            <tbody>
              {stats.perGuild.map(g => <GuildRow key={g.guildId} g={g} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
