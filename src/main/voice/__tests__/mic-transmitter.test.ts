import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @discordjs/voice and prism-media at module level so the transmitter
// can be constructed in tests without native modules.
vi.mock('prism-media', async () => {
  const { PassThrough } = await import('node:stream');
  class Encoder extends PassThrough {
    constructor(_opts?: any) { super(); }
  }
  return { default: { opus: { Encoder } } };
});
vi.mock('@discordjs/voice', () => ({
  createAudioPlayer: () => ({ play: vi.fn(), stop: vi.fn(), on: vi.fn() }),
  createAudioResource: vi.fn(() => ({})),
  StreamType: { Opus: 'opus' },
  VoiceConnectionStatus: { Destroyed: 'destroyed', Ready: 'ready' },
}));

import { MicTransmitter } from '../mic-transmitter';

function makeFakes() {
  const setSpeaking = vi.fn();
  const subscribe = vi.fn();
  const connection: any = {
    setSpeaking,
    subscribe,
    state: { status: 'ready' },
  };
  const setSelfMute = vi.fn();
  const voiceManager: any = {
    getConnection: () => connection,
    setSelfMute,
  };
  return { connection, voiceManager, setSpeaking, setSelfMute, subscribe };
}

describe('MicTransmitter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('start() un-mutes, sets speaking, and subscribes a player in order', () => {
    const f = makeFakes();
    const tx = new MicTransmitter(f.voiceManager);
    tx.start();
    expect(f.setSelfMute).toHaveBeenCalledWith(false);
    expect(f.setSpeaking).toHaveBeenCalledWith(1);
    expect(f.subscribe).toHaveBeenCalledTimes(1);
    // setSpeaking(1) must precede setSelfMute(false) so the bot is never
    // un-muted while Discord still thinks it's silent.
    const subscribeOrder = f.subscribe.mock.invocationCallOrder[0]!;
    const speakingOrder = f.setSpeaking.mock.invocationCallOrder[0]!;
    const muteOrder = f.setSelfMute.mock.invocationCallOrder[0]!;
    expect(subscribeOrder).toBeLessThan(speakingOrder);
    expect(speakingOrder).toBeLessThan(muteOrder);
  });

  it('stop() drains, clears speaking, then mutes — in order', () => {
    const f = makeFakes();
    const tx = new MicTransmitter(f.voiceManager);
    tx.start();
    tx.frame(new Int16Array(960));
    f.setSpeaking.mockClear();
    f.setSelfMute.mockClear();
    tx.stop();
    expect(f.setSpeaking).toHaveBeenLastCalledWith(0);
    expect(f.setSelfMute).toHaveBeenLastCalledWith(true);
    const speakingOrder = f.setSpeaking.mock.invocationCallOrder[0]!;
    const muteOrder = f.setSelfMute.mock.invocationCallOrder[0]!;
    expect(speakingOrder).toBeLessThan(muteOrder);
  });

  it('frame() before start() is dropped silently (no throw)', () => {
    const f = makeFakes();
    const tx = new MicTransmitter(f.voiceManager);
    expect(() => tx.frame(new Int16Array(960))).not.toThrow();
    expect(f.setSpeaking).not.toHaveBeenCalled();
  });

  it('start() is a no-op when no connection exists', () => {
    const setSelfMute = vi.fn();
    const voiceManager: any = { getConnection: () => null, setSelfMute };
    const tx = new MicTransmitter(voiceManager);
    tx.start();
    expect(setSelfMute).not.toHaveBeenCalled();
  });

  it('multiple start/stop cycles are clean (no leaked encoder)', () => {
    const f = makeFakes();
    const tx = new MicTransmitter(f.voiceManager);
    for (let i = 0; i < 3; i++) {
      tx.start();
      tx.frame(new Int16Array(960));
      tx.stop();
    }
    expect(f.subscribe).toHaveBeenCalledTimes(3);
    expect(f.setSpeaking.mock.calls.filter(c => c[0] === 1)).toHaveLength(3);
    expect(f.setSpeaking.mock.calls.filter(c => c[0] === 0)).toHaveLength(3);
  });
});
