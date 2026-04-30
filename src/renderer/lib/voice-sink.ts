// Renderer-side audio playback for the listen-only voice channel.
//
// The main process emits one mixed PCM frame (Int16Array, 48kHz, stereo,
// interleaved, 1920 samples) per 20ms tick. We forward each frame to an
// AudioWorklet which drains them onto the audio device with a small jitter
// buffer. Float conversion happens inside the worklet so we don't double-copy.
import workletUrl from './voice-worklet.js?url';

let ctx: AudioContext | null = null;
let node: AudioWorkletNode | null = null;
let unsubscribe: (() => void) | null = null;
let active = false;

export async function startVoiceSink(): Promise<void> {
  if (active) return;
  active = true;

  // 48kHz to match Discord — avoids resampling in the audio graph.
  ctx = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(workletUrl);
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
