import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DMList } from '../DMList';

vi.mock('../../lib/api', () => ({
  api: {
    dms: {
      list: vi.fn(async () => ({ ok: true, data: [
        { channelId: 'a', userId: 'ua', userUsername: 'alice', userGlobalName: 'Alice', userAvatar: null, lastMessageId: 'm', lastMessagePreview: 'hi', inert: false, createdAt: 1, updatedAt: 2 },
        { channelId: 'b', userId: 'ub', userUsername: 'bob',   userGlobalName: null,    userAvatar: null, lastMessageId: null, lastMessagePreview: null, inert: false, createdAt: 1, updatedAt: 1 },
      ] })),
    },
    events: { onMessageCreate: vi.fn(() => () => {}) },
    prefs: { get: vi.fn(async () => ({ ok: true, data: null })), set: vi.fn(async () => ({ ok: true })) },
    guilds: { list: vi.fn(async () => ({ ok: true, data: [] })) },
  },
}));

vi.mock('../../lib/use-unreads', () => ({
  useUnreads: () => ({
    channelIds: new Set(),
    guildIds: new Set(),
    mentionChannelIds: new Set(),
    mentionGuildIds: new Set(),
    mentionGuildCounts: new Map(),
    mentionChannelCounts: new Map(),
    mutedChannelIds: new Set(),
    dmUnreadChannelIds: new Set(),
    dmMentionCount: 0,
    toggleMuted: vi.fn(),
    markGuildRead: vi.fn(),
    markDMsRead: vi.fn(),
  }),
}));

describe('<DMList>', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders DMs in API order and supports filtering', async () => {
    const onSelect = vi.fn();
    render(<DMList activeChannelId={null} onSelect={onSelect} />);
    await screen.findByText('Alice');
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('bob')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Find a DM'), { target: { value: 'al' } });
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.queryByText('bob')).toBeNull();
  });

  it('selects a DM on click', async () => {
    const onSelect = vi.fn();
    render(<DMList activeChannelId={null} onSelect={onSelect} />);
    await screen.findByText('Alice');
    fireEvent.click(screen.getByText('Alice'));
    expect(onSelect).toHaveBeenCalledWith('a');
  });
});
