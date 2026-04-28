import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { MessageSummary, GatewayState } from '../../../shared/domain';

const mkMsg = (id: string, channelId: string, createdAt = id.length): MessageSummary => ({
  id, channelId, authorId: 'u1', authorTag: 'u1', authorAvatarUrl: null,
  content: id, createdAt, editedAt: null, hasEmbeds: false, hasAttachments: false,
  attachments: [], embeds: [], mentions: [], replyTo: null, systemKind: null,
});

let messageCreateCb: ((p: { channelId: string; message: MessageSummary }) => void) | null = null;
let messageUpdateCb: ((p: { channelId: string; message: MessageSummary }) => void) | null = null;
let messageDeleteCb: ((p: { channelId: string; messageId: string }) => void) | null = null;
let gatewayCb: ((s: GatewayState) => void) | null = null;
const historyMock = vi.fn();

vi.stubGlobal('window', Object.assign(globalThis.window ?? {}, {
  botcord: {
    messages: { history: historyMock },
    events: {
      onMessageCreate: (cb: typeof messageCreateCb) => { messageCreateCb = cb; return () => { messageCreateCb = null; }; },
      onMessageUpdate: (cb: typeof messageUpdateCb) => { messageUpdateCb = cb; return () => { messageUpdateCb = null; }; },
      onMessageDelete: (cb: typeof messageDeleteCb) => { messageDeleteCb = cb; return () => { messageDeleteCb = null; }; },
      onGatewayState: (cb: typeof gatewayCb) => { gatewayCb = cb; return () => { gatewayCb = null; }; },
    },
  },
}));

import { useChannelMessages } from '../use-channel-messages';

beforeEach(() => {
  historyMock.mockReset();
  messageCreateCb = null;
  messageUpdateCb = null;
  messageDeleteCb = null;
});

describe('useChannelMessages', () => {
  it('fetches initial history sorted oldest-first', async () => {
    historyMock.mockResolvedValue({ ok: true, data: [mkMsg('c', 'chan-1'), mkMsg('a', 'chan-1'), mkMsg('b', 'chan-1')] });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => expect(result.current.messages.length).toBe(3));
    expect(result.current.messages.map(m => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('appends on messageCreate for matching channel', async () => {
    historyMock.mockResolvedValue({ ok: true, data: [mkMsg('a', 'chan-1')] });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    act(() => { messageCreateCb?.({ channelId: 'chan-1', message: mkMsg('b', 'chan-1') }); });
    expect(result.current.messages.map(m => m.id)).toEqual(['a', 'b']);
  });

  it('ignores messageCreate for other channels', async () => {
    historyMock.mockResolvedValue({ ok: true, data: [mkMsg('a', 'chan-1')] });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    act(() => { messageCreateCb?.({ channelId: 'chan-other', message: mkMsg('b', 'chan-other') }); });
    expect(result.current.messages.map(m => m.id)).toEqual(['a']);
  });

  it('dedupes when messageCreate arrives for an id we already have', async () => {
    historyMock.mockResolvedValue({ ok: true, data: [mkMsg('a', 'chan-1')] });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    act(() => { messageCreateCb?.({ channelId: 'chan-1', message: mkMsg('a', 'chan-1') }); });
    expect(result.current.messages.length).toBe(1);
  });

  it('patches in place on messageUpdate', async () => {
    historyMock.mockResolvedValue({ ok: true, data: [mkMsg('a', 'chan-1')] });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    act(() => { messageUpdateCb?.({ channelId: 'chan-1', message: { ...mkMsg('a', 'chan-1'), content: 'edited' } }); });
    expect(result.current.messages[0]!.content).toBe('edited');
  });

  it('removes on messageDelete', async () => {
    historyMock.mockResolvedValue({ ok: true, data: [mkMsg('a', 'chan-1'), mkMsg('b', 'chan-1')] });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => expect(result.current.messages.length).toBe(2));
    act(() => { messageDeleteCb?.({ channelId: 'chan-1', messageId: 'a' }); });
    expect(result.current.messages.map(m => m.id)).toEqual(['b']);
  });

  it('loadOlder prepends and stops paginating when fewer than limit returned', async () => {
    historyMock.mockResolvedValueOnce({ ok: true, data: Array.from({ length: 50 }, (_, i) => mkMsg(`m${100 - i}`, 'chan-1', 1000 - i)) });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => expect(result.current.messages.length).toBe(50));

    historyMock.mockResolvedValueOnce({ ok: true, data: Array.from({ length: 50 }, (_, i) => mkMsg(`m${50 - i}`, 'chan-1', 500 - i)) });
    await act(async () => { await result.current.loadOlder(); });
    expect(result.current.messages.length).toBe(100);
    expect(result.current.hasMore).toBe(true);

    historyMock.mockResolvedValueOnce({ ok: true, data: [mkMsg('x', 'chan-1', 1)] });
    await act(async () => { await result.current.loadOlder(); });
    expect(result.current.hasMore).toBe(false);
  });
});
