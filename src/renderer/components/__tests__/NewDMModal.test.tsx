import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { NewDMModal } from '../NewDMModal';

vi.mock('../../lib/api', () => ({
  api: {
    guilds: {
      list: vi.fn(async () => ({ ok: true, data: [
        { id: 'g1', name: 'My Guild', iconUrl: null, memberCount: 10 },
      ] })),
      searchMembers: vi.fn(async () => ({ ok: true, data: [
        { id: 'u1', username: 'alice', displayName: 'Alice', avatarUrl: null, roleColor: null },
      ] })),
    },
    dms: {
      openWithUser: vi.fn(async (uid: string) => ({
        ok: true,
        data: { channelId: 'c1', userId: uid, userUsername: 'alice', userGlobalName: null, userAvatar: null, lastMessageId: null, lastMessagePreview: null, inert: false, createdAt: 1, updatedAt: 1 },
      })),
    },
  },
}));

describe('<NewDMModal>', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('searches members on input and opens DM on click', async () => {
    const onClose = vi.fn();
    const onOpened = vi.fn();
    render(<NewDMModal onClose={onClose} onOpened={onOpened} />);
    fireEvent.change(screen.getByPlaceholderText('Search members across servers'), { target: { value: 'al' } });
    await waitFor(() => screen.getByText('Alice'));
    fireEvent.click(screen.getByText('Alice'));
    await waitFor(() => expect(onOpened).toHaveBeenCalled());
    expect(onOpened.mock.calls[0]![0].channelId).toBe('c1');
  });

  it('shows DMs-disabled error', async () => {
    const { api } = await import('../../lib/api');
    (api.dms.openWithUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false, error: { code: 'MISSING_PERMISSIONS', message: 'nope' },
    });
    render(<NewDMModal onClose={() => {}} onOpened={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Search members across servers'), { target: { value: 'al' } });
    await waitFor(() => screen.getByText('Alice'));
    fireEvent.click(screen.getByText('Alice'));
    await waitFor(() => screen.getByText(/DMs disabled/i));
  });
});
