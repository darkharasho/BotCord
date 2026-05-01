// Renderer-side audio playback for the listen-only voice channel.
//
// The main process emits one mixed PCM frame (Int16Array, 48kHz, stereo,
// interleaved, 1920 samples) per 20ms tick. We forward each frame to an
// AudioWorklet which drains them onto the audio device with a small jitter
// buffer. Float conversion happens inside the worklet so we don't double-copy.
import workletUrl from './voice-worklet.js?url';
import { api } from './api';

let ctx: AudioContext | null = null;
let node: AudioWorkletNode | null = null;
let unsubscribe: (() => void) | null = null;
let active = false;

async function applySinkId(target: AudioContext, deviceId: string): Promise<void> {
  // setSinkId throws if the deviceId no longer exists. Caller decides how to
  // recover — for the initial start we clear the stale pref; for live changes
  // we surface the error to the UI.
  // Cast: TS lib types may lag Chromium's AudioContext.setSinkId support.
  const ctxAny = target as unknown as { setSinkId?: (id: string) => Promise<void> };
  if (typeof ctxAny.setSinkId === 'function') {
    await ctxAny.setSinkId(deviceId);
  }
}

export async function startVoiceSink(): Promise<void> {
  if (active) return;
  active = true;

  // 48kHz to match Discord — avoids resampling in the audio graph.
  ctx = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(workletUrl);

  // Honor the saved output device, if any. Empty string means "system default".
  const pref = await api.prefs.get('audioOutputDeviceId');
  const desired = pref.ok && typeof pref.data === 'string' ? pref.data : '';
  if (desired) {
    try {
      await applySinkId(ctx, desired);
    } catch (e) {
      console.warn('[voice-sink] saved output device unavailable, falling back to default', e);
      api.prefs.set('audioOutputDeviceId', '');
    }
  }

  node = new AudioWorkletNode(ctx, 'voice-sink', { outputChannelCount: [2] });
  node.connect(ctx.destination);
  // Chromium's autoplay policy starts AudioContexts suspended unless the
  // creation is inline with a user gesture. Our state-event chain runs a
  // few ticks after the click, so resume explicitly.
  if (ctx.state === 'suspended') await ctx.resume();

  unsubscribe = window.botcord.voice.onFrame((buf) => {
    if (!node) return;
    // Convert Int16 PCM (in the IPC ArrayBuffer) to Float32 once, hand
    // ownership to the worklet via transfer to avoid an extra copy.
    const i16 = new Int16Array(buf);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i]! / 32_768;
    node.port.postMessage(f32, [f32.buffer]);
  });
}

export async function stopVoiceSink(): Promise<void> {
  active = false;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (node) { node.disconnect(); node = null; }
  if (ctx) { await ctx.close(); ctx = null; }
}

// Live output-device switch. No-op when the sink is not currently active —
// the next startVoiceSink will pick up the new pref. Errors propagate so the
// caller can show a toast and revert the dropdown.
export async function setVoiceSinkOutput(deviceId: string): Promise<void> {
  if (!ctx) return;
  await applySinkId(ctx, deviceId);
}
