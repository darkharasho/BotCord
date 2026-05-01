import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServersSection } from '../sections/ServersSection';

vi.mock('../../../lib/api', () => ({
  api: {
    guilds: {
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          { id: 'g1', name: 'Alpha', iconUrl: null, memberCount: 42 },
          { id: 'g2', name: 'Bravo', iconUrl: null, memberCount: 7 },
        ],
      }),
      listChannels: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    },
    autonomy: {
      detect: vi.fn().mockResolvedValue({ found: true }),
      getGuildConfig: vi.fn().mockResolvedValue({
        ok: true,
        data: { guildId: 'g1', enabled: false, channelIds: [], contextSize: 20, systemPrompt: null, cooldownMs: 5000, updatedAt: 0 },
      }),
      setGuildConfig: vi.fn(),
    },
    events: {
      onGuildUpdate: () => () => {},
      onGatewayState: () => () => {},
    },
  },
}));

describe('ServersSection', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the guild list, then drills into a selected guild', async () => {
    render(<ServersSection />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Alpha'));

    await waitFor(() => {
      expect(screen.getByText(/← Servers/)).toBeInTheDocument();
    });
  });

  it('back link returns to the guild list', async () => {
    render(<ServersSection />);
    fireEvent.click(await screen.findByText('Alpha'));
    fireEvent.click(await screen.findByText(/← Servers/));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search servers/i)).toBeInTheDocument();
    });
  });

  it('filters guilds by search query', async () => {
    render(<ServersSection />);
    await screen.findByText('Alpha');
    fireEvent.change(screen.getByPlaceholderText(/search servers/i), { target: { value: 'brav' } });
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
  });
});
