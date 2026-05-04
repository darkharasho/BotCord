import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AutonomyUsagePanel } from '../AutonomyUsagePanel';
import type { AutonomyUsageStatsView } from '../../../shared/ipc-contract';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var window: any;
}

function makeStats(partial: Partial<AutonomyUsageStatsView> = {}): AutonomyUsageStatsView {
  const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, runCount: 0 };
  const empty = { autonomous: { ...zero }, draft: { ...zero }, combined: { ...zero } };
  return {
    lifetime: empty,
    last7d: empty,
    perGuild: [],
    ...partial,
  };
}

beforeEach(() => {
  // jsdom provides window; attach a botcord stub.
  (globalThis as any).window.botcord = {
    autonomy: {
      getUsageStats: vi.fn(),
    },
  };
});

describe('AutonomyUsagePanel', () => {
  it('renders empty state when no usage rows', async () => {
    (window as any).botcord.autonomy.getUsageStats.mockResolvedValue({ ok: true, data: makeStats() });
    render(<AutonomyUsagePanel />);
    await waitFor(() => expect(screen.getByText(/no autonomy usage recorded yet/i)).toBeInTheDocument());
  });

  it('renders totals and per-guild rows', async () => {
    const stats: AutonomyUsageStatsView = {
      lifetime: {
        autonomous: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.50, runCount: 5 },
        draft:      { inputTokens: 200,  outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.10, runCount: 2 },
        combined:   { inputTokens: 1200, outputTokens: 600, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.60, runCount: 7 },
      },
      last7d: {
        autonomous: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.05, runCount: 1 },
        draft:      { inputTokens: 0,   outputTokens: 0,  cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0,    runCount: 0 },
        combined:   { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.05, runCount: 1 },
      },
      perGuild: [
        {
          guildId: 'g1',
          guildName: 'Test Guild',
          lifetime: {
            autonomous: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.50, runCount: 5 },
            draft:      { inputTokens: 200,  outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.10, runCount: 2 },
            combined:   { inputTokens: 1200, outputTokens: 600, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.60, runCount: 7 },
          },
          last7d: {
            autonomous: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.05, runCount: 1 },
            draft:      { inputTokens: 0,   outputTokens: 0,  cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0,    runCount: 0 },
            combined:   { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.05, runCount: 1 },
          },
        },
      ],
    };
    (window as any).botcord.autonomy.getUsageStats.mockResolvedValue({ ok: true, data: stats });
    render(<AutonomyUsagePanel />);

    await waitFor(() => expect(screen.getByText('Test Guild')).toBeInTheDocument());
    expect(screen.getByText(/lifetime/i)).toBeInTheDocument();
    expect(screen.getByText(/last 7 days/i)).toBeInTheDocument();
    // Token formatting: 1,200 with thousands separator
    expect(screen.getAllByText(/1,200/).length).toBeGreaterThan(0);
  });

  it('formats values >= 1M with M suffix', async () => {
    const big = { inputTokens: 1_240_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, runCount: 1 };
    const stats = makeStats({
      lifetime: { autonomous: big, draft: { ...big, inputTokens: 0 }, combined: big },
    });
    (window as any).botcord.autonomy.getUsageStats.mockResolvedValue({ ok: true, data: stats });
    render(<AutonomyUsagePanel />);
    await waitFor(() => expect(screen.getAllByText(/1\.24M/).length).toBeGreaterThan(0));
  });

  it('shows error and a Retry button when getUsageStats fails', async () => {
    (window as any).botcord.autonomy.getUsageStats.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: 'boom' } });
    render(<AutonomyUsagePanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument());
  });
});
