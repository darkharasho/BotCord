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
      globalConfig: () => ({ enabled: true, systemPrompt: 'be brief', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events,
    });
    const res = await mod.draftReply({
      requestId: 'r1',
      guildId: 'g',
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
      globalConfig: () => ({ enabled: false, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
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
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
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
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
    });
    const res = await mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe('hello there');
  });

  it('queues concurrent triggers in the same channel and processes them in order', async () => {
    // Each session waits for an external "release" before completing, so we
    // can hold the in-flight slot and prove the second request queues.
    const sessions: Array<{ resolve: () => void; sentDeltas: string[] }> = [];
    const host: AutonomyHost = {
      detect: async () => ({ found: true }),
      startSession: async () => {
        const slot: { resolve: () => void; sentDeltas: string[] } = { resolve: () => {}, sentDeltas: [] };
        sessions.push(slot);
        return {
          send: (prompt: string) => {
            slot.sentDeltas.push(prompt);
            return (async function* () {
              await new Promise<void>(r => { slot.resolve = r; });
              yield { type: 'assistant.text_delta', delta: 'reply for ' + slot.sentDeltas[0]!.slice(-3) } as CDKEvent;
              yield { type: 'session.done', stopReason: 'end_turn' } as CDKEvent;
            })();
          },
          abort: async () => {},
          close: async () => {},
        };
      },
    };
    const mod = createAutonomyModule({
      host,
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
    });

    const a = mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target: { ...target, id: 'aaa', content: 'first aaa' } });
    const b = mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target: { ...target, id: 'bbb', content: 'second bbb' } });

    // Let the queue scheduler run; only the first session should have started.
    await new Promise(r => setTimeout(r, 20));
    expect(sessions.length).toBe(1);

    sessions[0]!.resolve();
    const ra = await a;
    expect(ra.ok).toBe(true);

    // Wait long enough for the second to be picked up after the throttle finishes.
    await new Promise(r => setTimeout(r, 600));
    expect(sessions.length).toBe(2);
    sessions[1]!.resolve();
    const rb = await b;
    expect(rb.ok).toBe(true);
  });

  it('drops the oldest queued item when the queue overflows', async () => {
    let release: () => void = () => {};
    const host: AutonomyHost = {
      detect: async () => ({ found: true }),
      startSession: async () => ({
        send: () => (async function* () {
          await new Promise<void>(r => { release = r; });
          yield { type: 'session.done', stopReason: 'end_turn' } as CDKEvent;
        })(),
        abort: async () => {},
        close: async () => {},
      }),
    };
    const mod = createAutonomyModule({
      host,
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 2, queueTtlSeconds: 60 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
    });

    // First request grabs the slot. Subsequent two fill the queue. The
    // fourth bumps the oldest queued item (not the running one).
    const a = mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target: { ...target, id: 'a', content: 'a' } });
    const b = mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target: { ...target, id: 'b', content: 'b' } });
    const c = mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target: { ...target, id: 'c', content: 'c' } });
    // Let the running one get into flight.
    await new Promise(r => setTimeout(r, 10));

    const d = mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target: { ...target, id: 'd', content: 'd' } });

    const rb = await b;
    expect(rb.ok).toBe(false);
    if (!rb.ok) expect(rb.reason).toBe('dropped');

    // Release everything else so the test ends cleanly.
    release(); // a
    await a;
    await new Promise(r => setTimeout(r, 20));
    release(); // c
    await c;
    await new Promise(r => setTimeout(r, 20));
    release(); // d
    await d;
  });

  it('invokes recordUsage with autonomous kind and guildId on a successful run', async () => {
    const recordUsage = vi.fn();
    const host: AutonomyHost = {
      detect: async () => ({ found: true }),
      startSession: async () => ({
        send: () => (async function* () {
          yield { type: 'assistant.text_delta', delta: 'hi' } as CDKEvent;
          yield {
            type: 'session.done',
            stopReason: 'end_turn',
            usage: { inputTokens: 12, outputTokens: 7, cacheReadTokens: 2, cacheCreationTokens: 1 },
            costUsd: 0.0042,
          } as unknown as CDKEvent;
        })(),
        abort: async () => {},
        close: async () => {},
      }),
    };
    const mod = createAutonomyModule({
      host,
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
      recordUsage,
    });
    const res = await mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(true);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    const arg = recordUsage.mock.calls[0]![0];
    expect(arg.kind).toBe('autonomous');
    expect(arg.guildId).toBe('g');
    expect(arg.usage).toEqual({ inputTokens: 12, outputTokens: 7, cacheReadTokens: 2, cacheCreationTokens: 1 });
    expect(arg.costUsd).toBeCloseTo(0.0042);
    expect(typeof arg.at).toBe('number');
  });

  it('invokes recordUsage with draft kind and propagates guildId from DraftRequest', async () => {
    const recordUsage = vi.fn();
    const host: AutonomyHost = {
      detect: async () => ({ found: true }),
      startSession: async () => ({
        send: () => (async function* () {
          yield { type: 'assistant.text_delta', delta: 'ok' } as CDKEvent;
          yield {
            type: 'session.done',
            stopReason: 'end_turn',
            usage: { inputTokens: 4, outputTokens: 2 },
            costUsd: 0.001,
          } as unknown as CDKEvent;
        })(),
        abort: async () => {},
        close: async () => {},
      }),
    };
    const mod = createAutonomyModule({
      host,
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
      recordUsage,
    });
    const res = await mod.draftReply({ requestId: 'r', guildId: 'g42', channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(true);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    const arg = recordUsage.mock.calls[0]![0];
    expect(arg.kind).toBe('draft');
    expect(arg.guildId).toBe('g42');
  });

  it('invokes recordUsage with null guildId for DM drafts', async () => {
    const recordUsage = vi.fn();
    const host: AutonomyHost = {
      detect: async () => ({ found: true }),
      startSession: async () => ({
        send: () => (async function* () {
          yield { type: 'assistant.text_delta', delta: 'ok' } as CDKEvent;
          yield { type: 'session.done', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } } as unknown as CDKEvent;
        })(),
        abort: async () => {},
        close: async () => {},
      }),
    };
    const mod = createAutonomyModule({
      host,
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
      recordUsage,
    });
    const res = await mod.draftReply({ requestId: 'r', guildId: null, channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(true);
    expect(recordUsage.mock.calls[0]![0].guildId).toBeNull();
  });

  it('does not call recordUsage when the host throws before session.done', async () => {
    const recordUsage = vi.fn();
    const host: AutonomyHost = {
      detect: async () => ({ found: true }),
      startSession: async () => { throw new Error('host kaboom'); },
    };
    const mod = createAutonomyModule({
      host,
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
      recordUsage,
    });
    const res = await mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(false);
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('swallows errors thrown by recordUsage and still returns text', async () => {
    const recordUsage = vi.fn(() => { throw new Error('disk full'); });
    const host: AutonomyHost = {
      detect: async () => ({ found: true }),
      startSession: async () => ({
        send: () => (async function* () {
          yield { type: 'assistant.text_delta', delta: 'hi' } as CDKEvent;
          yield {
            type: 'session.done',
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1 },
          } as unknown as CDKEvent;
        })(),
        abort: async () => {},
        close: async () => {},
      }),
    };
    const mod = createAutonomyModule({
      host,
      globalConfig: () => ({ enabled: true, systemPrompt: '', rateCapPerMin: 100, visionEnabled: false, model: '', queueMaxDepth: 5, queueTtlSeconds: 60 }),
      guildConfig: () => ({ guildId: 'g', enabled: true, channelIds: ['c'], contextSize: 20, systemPrompt: null, cooldownMs: 0, updatedAt: 0 }),
      cwd: '/tmp/cdk',
      events: { onDelta: vi.fn(), onDone: vi.fn() },
      recordUsage,
    });
    const res = await mod.runAutonomous({ guildId: 'g', channelId: 'c', channelMeta: fakeChannelMeta, history, target });
    expect(res.ok).toBe(true);
    expect(recordUsage).toHaveBeenCalledTimes(1);
  });
});
