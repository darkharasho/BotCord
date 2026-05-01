import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to control voice-sink's module state across tests, so re-import
// fresh in each test via vi.resetModules().
beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('setVoiceSinkOutput', () => {
  it('is a no-op when the sink is not active', async () => {
    const setSinkId = vi.fn();
    class FakeAudioContext {
      setSinkId = setSinkId;
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const mod = await import('../voice-sink');
    await expect(mod.setVoiceSinkOutput('some-device-id')).resolves.toBeUndefined();
    expect(setSinkId).not.toHaveBeenCalled();
  });

  it('forwards device id to AudioContext.setSinkId when active', async () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined);

    // Stub AudioContext + AudioWorkletNode globals before importing the module.
    class FakeAudioContext {
      state = 'running';
      destination = {} as AudioDestinationNode;
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      setSinkId = setSinkId;
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
    }
    class FakeWorkletNode {
      port = { postMessage: vi.fn() };
      connect = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    vi.stubGlobal('window', {
      botcord: {
        voice: { onFrame: () => () => {} },
        prefs: { get: vi.fn().mockResolvedValue({ ok: true, data: '' }) },
      },
    });

    const mod = await import('../voice-sink');
    await mod.startVoiceSink();
    setSinkId.mockClear();

    await mod.setVoiceSinkOutput('headset-id');
    expect(setSinkId).toHaveBeenCalledWith('headset-id');

    // Empty string passes through as-is — the browser interprets '' as default.
    await mod.setVoiceSinkOutput('');
    expect(setSinkId).toHaveBeenLastCalledWith('');

    await mod.stopVoiceSink();
  });

  it('clears the saved output pref when setSinkId rejects on startup', async () => {
    const setSinkId = vi.fn().mockRejectedValue(new Error('NotFoundError'));
    const prefsSet = vi.fn().mockResolvedValue({ ok: true });

    class FakeAudioContext {
      state = 'running';
      destination = {} as AudioDestinationNode;
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      setSinkId = setSinkId;
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
    }
    class FakeWorkletNode {
      port = { postMessage: vi.fn() };
      connect = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    vi.stubGlobal('console', { ...console, warn: vi.fn() });
    vi.stubGlobal('window', {
      botcord: {
        voice: { onFrame: () => () => {} },
        prefs: {
          get: vi.fn().mockResolvedValue({ ok: true, data: 'stale-id' }),
          set: prefsSet,
        },
      },
    });

    const mod = await import('../voice-sink');
    await mod.startVoiceSink();

    expect(setSinkId).toHaveBeenCalledWith('stale-id');
    expect(prefsSet).toHaveBeenCalledWith('audioOutputDeviceId', '');

    await mod.stopVoiceSink();
  });
});
