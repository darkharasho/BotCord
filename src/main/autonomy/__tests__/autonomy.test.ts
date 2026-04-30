import { describe, it, expect, vi } from 'vitest';
import { createAutonomyModule, type AutonomyEvents } from '../index';
import type { AutonomyHost, AutonomySession, ChannelHistoryEntry } from '../types';
import type { CDKEvent } from '@claude-cdk/core';

function fakeHost(scriptedDeltas: string[]): AutonomyHost {
  return {
    detect: async () => ({ found: true, version: '0.0.0' }),
    startSession: async (): Promise<AutonomySession> => ({
      send: () => (async function* (): AsyncGenerator<CDKEvent> {
        for (const d of scriptedDeltas) yield { type: 'assistant.text_delta', delta: d } as CDKEvent;
        yield { type: 'session.done', stopReason: 'end_turn' } as CDKEvent;
      })(),
      abort: async () => {},
      close: async () => {},
    }),
  };
}

const fakeChannelMeta = { guildName: 'G', channelName: 'c', channelTopic: null };
const target = { id: 'm1', authorId: 'u1', authorDisplayName: 'Alice', isBot: false, createdAt: 1, content: 'hi' };
const history: ChannelHistoryEntry[] = [];

describe('createAutonomyModule', () => {
  it('generates a reply via the host and emits assembled text', async () => {
    const events: AutonomyEvents = { onDelta: vi.fn(), onDone: vi.fn() };
    const mod = createAutonomyModule({
      host: fakeHost(['hel', 'lo ', 'world']),
      globalConfig: () => ({ enabled: true, systemPrompt: 'be brief', rateCapPerMin: 100 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events,
    });
    const res = await mod.draftReply({
      requestId: 'r1',
      channelMeta: fakeChannelMeta,
      history,
      target,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe('hello world');
    expect(events.onDelta).toHaveBeenCalledTimes(3);
    expect(events.onDone).toHaveBeenCalledOnce();
  });

  it('runAutonomous skips when global is disabled', async () => {
    const startSpy = vi.fn();
    const host: AutonomyHost = { detect: async () => ({ found: true }), startSession: startSpy as never };
    const mod = createAutonomyModule({
      host,
      globalConfig: () => ({ enabled: false, systemPrompt: '', rateCapPerMin: 100 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
    });
    const res = await mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('global-disabled');
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('runAutonomous skips when channel is not in allowlist', async () => {
    const mod = createAutonomyModule({
      host: fakeHost([]),
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['other'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
    });
    const res = await mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: { ...fakeChannelMeta, channelName: 'c' }, history, target });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not-allowed');
  });

  it('runAutonomous post-processes the assembled text', async () => {
    const mod = createAutonomyModule({
      host: fakeHost(['hello @everyone there']),
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
    });
    const res = await mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe('hello there');
  });
});
