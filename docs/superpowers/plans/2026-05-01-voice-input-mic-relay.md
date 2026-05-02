# Voice Input — Mic Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a microphone-input path that funnels the user's mic audio out through the connected bot, with Discord-style PTT/Voice-Activity ergonomics, layered onto BotCord's existing listen-only voice pipeline.

**Architecture:** Renderer captures mic via `getUserMedia` + `AudioWorklet`, runs VAD/PTT gating locally, ships gated 20 ms PCM frames over IPC to the main process. Main process encodes to Opus via `prism-media`, plays through a `@discordjs/voice` `AudioPlayer` subscribed to the existing `VoiceConnection`, and toggles `selfMute`/`setSpeaking` in lockstep with the gate.

**Tech Stack:** Electron, React, TypeScript, `@discordjs/voice`, `prism-media` (opus), `better-sqlite3` (prefs), Web Audio API + AudioWorklet (renderer), Vitest (tests).

**Spec:** `docs/superpowers/specs/2026-05-01-voice-input-mic-relay-design.md`

---

## File Structure

**New files:**
- `src/shared/voice-input.ts` — `VoiceInputSettings` type + defaults + pure VAD gate function.
- `src/main/voice/mic-transmitter.ts` — `MicTransmitter` class (PCM → Opus → AudioPlayer).
- `src/main/voice/__tests__/mic-transmitter.test.ts` — unit tests for the transmitter.
- `src/shared/__tests__/voice-input.test.ts` — unit tests for the VAD gate function.
- `src/renderer/lib/mic-worklet-source.ts` — AudioWorkletProcessor source as a string (loaded via blob URL).
- `src/renderer/lib/mic-capture.ts` — `MicCaptureManager` class.
- `src/renderer/lib/use-mic.ts` — React hook wrapping `MicCaptureManager`.
- `src/renderer/components/voice/MicIndicator.tsx` — green-when-transmitting mic icon.
- `src/renderer/components/voice/VoiceInputSettings.tsx` — settings panel.

**Modified files:**
- `src/shared/domain.ts` — extend `Prefs` with `voiceInput` blob.
- `src/shared/ipc-contract.ts` — add `mic.start`, `mic.frame`, `mic.stop`, `voice.setMute` channels and API methods.
- `src/preload/expose.ts` — bridge new mic channels.
- `src/main/voice/voice-manager.ts` — add `getConnection()`, `setSelfMute(b)`.
- `src/main/ipc/voice.ts` — register mic IPC handlers, instantiate `MicTransmitter`.
- `src/main/index.ts` (or main entry) — register PTT global hotkey + `blur`/`suspend` handlers.
- `src/renderer/components/<voice connection pill>` — embed `MicIndicator`.
- A settings route component — add a "Voice Input" section.

---

## Task 1: Settings type, defaults, and prefs storage

**Files:**
- Create: `src/shared/voice-input.ts`
- Modify: `src/shared/domain.ts:326-349` (extend `Prefs`)
- Test: `src/shared/__tests__/voice-input.test.ts`

- [ ] **Step 1: Write failing test for default settings shape**

```ts
// src/shared/__tests__/voice-input.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_VOICE_INPUT_SETTINGS } from '../voice-input';

describe('DEFAULT_VOICE_INPUT_SETTINGS', () => {
  it('starts in voice-activity mode at a reasonable threshold', () => {
    expect(DEFAULT_VOICE_INPUT_SETTINGS.mode).toBe('va');
    expect(DEFAULT_VOICE_INPUT_SETTINGS.vadThreshold).toBeGreaterThan(0);
    expect(DEFAULT_VOICE_INPUT_SETTINGS.vadThreshold).toBeLessThan(1);
  });

  it('defaults to global PTT scope, not yet downgraded, unmuted, gain 1', () => {
    expect(DEFAULT_VOICE_INPUT_SETTINGS.pttScope).toBe('global');
    expect(DEFAULT_VOICE_INPUT_SETTINGS.pttScopeDowngraded).toBe(false);
    expect(DEFAULT_VOICE_INPUT_SETTINGS.muted).toBe(false);
    expect(DEFAULT_VOICE_INPUT_SETTINGS.inputGain).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test, see it fail**

Run: `npx vitest run src/shared/__tests__/voice-input.test.ts`
Expected: FAIL — module `../voice-input` not found.

- [ ] **Step 3: Create the module with type and defaults**

```ts
// src/shared/voice-input.ts
export type VoiceInputMode = 'ptt' | 'va';
export type PttScope = 'global' | 'app';

export type PttBinding = {
  // Electron accelerator string, e.g. "Control+Shift+Space" or "F13".
  accelerator: string;
};

export type VoiceInputSettings = {
  mode: VoiceInputMode;
  pttBinding: PttBinding | null;
  pttScope: PttScope;
  pttScopeDowngraded: boolean;
  vadThreshold: number;       // 0..1 RMS
  inputDeviceId: string | null;
  inputGain: number;          // 0..2
  muted: boolean;
};

export const DEFAULT_VOICE_INPUT_SETTINGS: VoiceInputSettings = {
  mode: 'va',
  pttBinding: null,
  pttScope: 'global',
  pttScopeDowngraded: false,
  vadThreshold: 0.04,
  inputDeviceId: null,
  inputGain: 1,
  muted: false,
};
```

- [ ] **Step 4: Run the test, see it pass**

Run: `npx vitest run src/shared/__tests__/voice-input.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `voiceInput` into the `Prefs` domain type**

Edit `src/shared/domain.ts` — add the import and field:

```ts
// near the top, with other shared imports
import type { VoiceInputSettings } from './voice-input';

// inside the Prefs type definition (extend the existing block)
export type Prefs = {
  // ...existing fields...
  audioOutputDeviceId: string;
  audioInputDeviceId: string;
  notifyOnDM?: boolean;
  voiceInput?: VoiceInputSettings;
};
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/voice-input.ts src/shared/__tests__/voice-input.test.ts src/shared/domain.ts
git commit -m "feat(voice-input): settings type and defaults"
```

---

## Task 2: Pure VAD gate function

**Files:**
- Modify: `src/shared/voice-input.ts`
- Test: `src/shared/__tests__/voice-input.test.ts`

The gate is extracted as a pure function so it can be unit-tested without Web Audio.

- [ ] **Step 1: Write failing tests for the gate**

Append to `src/shared/__tests__/voice-input.test.ts`:

```ts
import { createVadGate } from '../voice-input';

describe('createVadGate', () => {
  it('opens when RMS crosses threshold and closes after the tail', () => {
    const gate = createVadGate({ threshold: 0.1, tailFrames: 5 });
    expect(gate.step(0.05)).toBe(false);
    expect(gate.step(0.2)).toBe(true);   // open
    expect(gate.step(0.05)).toBe(true);  // tail frame 1
    expect(gate.step(0.05)).toBe(true);  // tail frame 2
    expect(gate.step(0.05)).toBe(true);  // tail frame 3
    expect(gate.step(0.05)).toBe(true);  // tail frame 4
    expect(gate.step(0.05)).toBe(true);  // tail frame 5
    expect(gate.step(0.05)).toBe(false); // closed
  });

  it('resets the tail when RMS crosses threshold mid-tail', () => {
    const gate = createVadGate({ threshold: 0.1, tailFrames: 3 });
    gate.step(0.2);          // open
    gate.step(0.05);         // tail 1
    gate.step(0.2);          // re-open, tail resets
    expect(gate.step(0.05)).toBe(true);  // tail 1
    expect(gate.step(0.05)).toBe(true);  // tail 2
    expect(gate.step(0.05)).toBe(true);  // tail 3
    expect(gate.step(0.05)).toBe(false);
  });

  it('threshold of 0 keeps the gate open continuously', () => {
    const gate = createVadGate({ threshold: 0, tailFrames: 1 });
    expect(gate.step(0)).toBe(true);
    expect(gate.step(0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests, see them fail**

Run: `npx vitest run src/shared/__tests__/voice-input.test.ts`
Expected: FAIL — `createVadGate` not exported.

- [ ] **Step 3: Implement the gate**

Append to `src/shared/voice-input.ts`:

```ts
export type VadGate = {
  step(rms: number): boolean;
  reset(): void;
};

export function createVadGate(opts: { threshold: number; tailFrames: number }): VadGate {
  let tailRemaining = 0;
  return {
    step(rms: number): boolean {
      if (rms > opts.threshold || opts.threshold === 0) {
        tailRemaining = opts.tailFrames;
        return true;
      }
      if (tailRemaining > 0) {
        tailRemaining--;
        return true;
      }
      return false;
    },
    reset() { tailRemaining = 0; },
  };
}
```

- [ ] **Step 4: Run the tests, see them pass**

Run: `npx vitest run src/shared/__tests__/voice-input.test.ts`
Expected: PASS (5 tests total in this file).

- [ ] **Step 5: Commit**

```bash
git add src/shared/voice-input.ts src/shared/__tests__/voice-input.test.ts
git commit -m "feat(voice-input): pure VAD gate function"
```

---

## Task 3: VoiceManager additions (`getConnection`, `setSelfMute`)

**Files:**
- Modify: `src/main/voice/voice-manager.ts`

The transmitter needs the active `VoiceConnection`, and we must un-mute while transmitting.

- [ ] **Step 1: Add `getConnection()` and `setSelfMute()` methods**

Edit `src/main/voice/voice-manager.ts`. Add these public methods to the `VoiceManager` class (after `getState`):

```ts
  getConnection(): VoiceConnection | null { return this.connection; }

  setSelfMute(selfMute: boolean): void {
    if (!this.connection) return;
    // discord.js exposes mute toggling via rejoin with a new joinConfig.
    // selfDeaf MUST stay false so the receive pipeline keeps getting voice.
    this.connection.rejoin({
      channelId: this.connection.joinConfig.channelId!,
      selfDeaf: false,
      selfMute,
    });
  }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/voice/voice-manager.ts
git commit -m "feat(voice): expose connection and self-mute toggle"
```

---

## Task 4: MicTransmitter (main process) — TDD

**Files:**
- Create: `src/main/voice/mic-transmitter.ts`
- Test: `src/main/voice/__tests__/mic-transmitter.test.ts`

This class drives the outbound audio: it owns one `AudioPlayer` and rebuilds an `Opus.Encoder` + `Readable` per gate-open. Tests use fake `VoiceConnection`/`VoiceManager` doubles.

- [ ] **Step 1: Write failing tests**

```ts
// src/main/voice/__tests__/mic-transmitter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
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

  it('start() un-mutes, sets speaking, and subscribes a player', () => {
    const f = makeFakes();
    const tx = new MicTransmitter(f.voiceManager);
    tx.start();
    expect(f.setSelfMute).toHaveBeenCalledWith(false);
    expect(f.setSpeaking).toHaveBeenCalledWith(1);
    expect(f.subscribe).toHaveBeenCalledTimes(1);
  });

  it('stop() drains, mutes, and clears speaking', () => {
    const f = makeFakes();
    const tx = new MicTransmitter(f.voiceManager);
    tx.start();
    tx.frame(new Int16Array(960));
    tx.stop();
    expect(f.setSpeaking).toHaveBeenLastCalledWith(0);
    expect(f.setSelfMute).toHaveBeenLastCalledWith(true);
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
```

- [ ] **Step 2: Run tests, see them fail**

Run: `npx vitest run src/main/voice/__tests__/mic-transmitter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `MicTransmitter`**

```ts
// src/main/voice/mic-transmitter.ts
import { Readable } from 'node:stream';
import { createAudioPlayer, createAudioResource, StreamType, type AudioPlayer } from '@discordjs/voice';
import prism from 'prism-media';
import type { VoiceManager } from './voice-manager';

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const FRAME_SAMPLES = 960; // 20 ms @ 48 kHz mono

// Wraps an in-process Readable that we push PCM frames into and end on `stop`.
function makePushable(): Readable & { pushFrame: (b: Buffer) => void; end: () => void } {
  const stream = new Readable({ read() { /* push-driven */ } }) as any;
  stream.pushFrame = (b: Buffer) => stream.push(b);
  stream.end = () => stream.push(null);
  return stream;
}

export class MicTransmitter {
  private player: AudioPlayer | null = null;
  private pcmStream: ReturnType<typeof makePushable> | null = null;
  private encoder: prism.opus.Encoder | null = null;
  private active = false;

  constructor(private voiceManager: Pick<VoiceManager, 'getConnection' | 'setSelfMute'>) {}

  start(): void {
    if (this.active) return;
    const connection = this.voiceManager.getConnection();
    if (!connection) return;

    this.pcmStream = makePushable();
    // Mono PCM in → stereo Opus out. The encoder handles up-mixing.
    this.encoder = new prism.opus.Encoder({
      rate: SAMPLE_RATE,
      channels: CHANNELS,
      frameSize: FRAME_SAMPLES,
    });

    // Mono → interleaved stereo before Opus encoding.
    const monoToStereo = new prism.opus.OggDemuxer ? null : null; // no-op import side-effect
    const stereoizer = new (require('node:stream').Transform)({
      transform(chunk: Buffer, _enc: string, cb: (e: Error | null, b?: Buffer) => void) {
        const samples = chunk.length / 2;
        const out = Buffer.alloc(samples * 4);
        for (let i = 0; i < samples; i++) {
          const s = chunk.readInt16LE(i * 2);
          out.writeInt16LE(s, i * 4);     // L
          out.writeInt16LE(s, i * 4 + 2); // R
        }
        cb(null, out);
      },
    });

    const opusStream = this.pcmStream.pipe(stereoizer).pipe(this.encoder);
    const resource = createAudioResource(opusStream, { inputType: StreamType.Opus });

    this.player = createAudioPlayer();
    connection.subscribe(this.player);
    this.player.play(resource);

    connection.setSpeaking(1);
    this.voiceManager.setSelfMute(false);
    this.active = true;
  }

  frame(pcm: Int16Array): void {
    if (!this.active || !this.pcmStream) return;
    // Copy into a Buffer view of the same bytes.
    const buf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    this.pcmStream.pushFrame(buf);
  }

  stop(): void {
    if (!this.active) return;
    const connection = this.voiceManager.getConnection();
    this.pcmStream?.end();
    this.player?.stop(true);
    this.encoder?.destroy();
    this.player = null;
    this.pcmStream = null;
    this.encoder = null;
    this.active = false;
    if (connection) {
      connection.setSpeaking(0);
    }
    this.voiceManager.setSelfMute(true);
  }

  isActive(): boolean { return this.active; }
}
```

- [ ] **Step 4: Run tests, see them pass**

Run: `npx vitest run src/main/voice/__tests__/mic-transmitter.test.ts`
Expected: PASS (5 tests).

If any test fails because `prism.opus.Encoder` cannot construct in the test environment, mock it at the top of the test file:

```ts
vi.mock('prism-media', () => ({
  default: {
    opus: { Encoder: class { destroy() {} on() {} pipe(x: any) { return x; } } },
  },
}));
vi.mock('@discordjs/voice', () => ({
  createAudioPlayer: () => ({ play: vi.fn(), stop: vi.fn(), on: vi.fn() }),
  createAudioResource: vi.fn(() => ({})),
  StreamType: { Opus: 'opus' },
}));
```

- [ ] **Step 5: Commit**

```bash
git add src/main/voice/mic-transmitter.ts src/main/voice/__tests__/mic-transmitter.test.ts
git commit -m "feat(voice): MicTransmitter for outbound PCM→Opus path"
```

---

## Task 5: IPC contract + preload bridge for mic channels

**Files:**
- Modify: `src/shared/ipc-contract.ts:215-220` (add channels and api methods)
- Modify: `src/preload/expose.ts:95-113` (bridge them)

- [ ] **Step 1: Add channels to `IPC_CHANNELS`**

Edit `src/shared/ipc-contract.ts` — add to the channels object next to the existing voice channels:

```ts
  'voice.join': 'voice.join',
  'voice.leave': 'voice.leave',
  'voice.getState': 'voice.getState',
  'voice.mic.start': 'voice.mic.start',
  'voice.mic.frame': 'voice.mic.frame',
  'voice.mic.stop': 'voice.mic.stop',
  'event.voiceState': 'event.voiceState',
  'event.voiceFrame': 'event.voiceFrame',
  'event.voiceSpeakers': 'event.voiceSpeakers',
```

- [ ] **Step 2: Extend `BotcordApi.voice` with mic methods**

In the same file, find the `voice:` block of the `BotcordApi` interface and add:

```ts
    micStart(): void;
    micFrame(pcm: ArrayBuffer): void;
    micStop(): void;
```

- [ ] **Step 3: Bridge in preload**

Edit `src/preload/expose.ts` inside the `voice:` block:

```ts
  voice: {
    join: (guildId, channelId) => invoke(IPC_CHANNELS['voice.join'], guildId, channelId),
    leave: () => invoke(IPC_CHANNELS['voice.leave']),
    getState: () => invoke(IPC_CHANNELS['voice.getState']),
    onState: (cb) => subscribe(IPC_CHANNELS['event.voiceState'], cb as (p: unknown) => void),
    onFrame: (cb) => { /* ...existing... */ },
    onSpeakers: (cb) => subscribe(IPC_CHANNELS['event.voiceSpeakers'], cb as (p: unknown) => void),
    micStart: () => ipcRenderer.send(IPC_CHANNELS['voice.mic.start']),
    micFrame: (pcm: ArrayBuffer) => ipcRenderer.send(IPC_CHANNELS['voice.mic.frame'], pcm),
    micStop: () => ipcRenderer.send(IPC_CHANNELS['voice.mic.stop']),
  },
```

(`send`, not `invoke` — these are fire-and-forget for latency.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/expose.ts
git commit -m "feat(voice): IPC channels for mic transmit"
```

---

## Task 6: Wire MicTransmitter into voice IPC

**Files:**
- Modify: `src/main/ipc/voice.ts`

- [ ] **Step 1: Instantiate and handle channels**

Replace the body of `registerVoiceHandlers` to add the transmitter:

```ts
import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { ClientManager } from '../discord/client-manager';
import { VoiceManager, type VoiceConnectionState } from '../voice/voice-manager';
import { MicTransmitter } from '../voice/mic-transmitter';

export function registerVoiceHandlers({ manager }: { manager: ClientManager }): VoiceManager {
  const voice = new VoiceManager(() => manager.getClient());
  const transmitter = new MicTransmitter(voice);

  voice.on('state', (state) => broadcast(IPC_CHANNELS['event.voiceState'], state));
  voice.on('frame', (frame) => {
    const buf = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
    broadcast(IPC_CHANNELS['event.voiceFrame'], buf);
  });
  voice.on('speakers', (levels) => {
    if (levels.size === 0) return;
    broadcast(IPC_CHANNELS['event.voiceSpeakers'], Object.fromEntries(levels));
  });

  ipcMain.handle(IPC_CHANNELS['voice.join'], async (_, guildId: unknown, channelId: unknown): Promise<Result<VoiceConnectionState>> => {
    if (typeof guildId !== 'string' || typeof channelId !== 'string') return err('INTERNAL', 'guildId and channelId required');
    try {
      await voice.joinChannel(guildId, channelId);
      return ok(voice.getState());
    } catch (e) {
      return err('INTERNAL', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['voice.leave'], (): Result<VoiceConnectionState> => {
    transmitter.stop();
    voice.leaveChannel();
    return ok(voice.getState());
  });

  ipcMain.handle(IPC_CHANNELS['voice.getState'], (): VoiceConnectionState => voice.getState());

  ipcMain.on(IPC_CHANNELS['voice.mic.start'], () => {
    try { transmitter.start(); } catch { /* surfaced via voiceState if encoder failed */ }
  });
  ipcMain.on(IPC_CHANNELS['voice.mic.frame'], (_evt, payload: ArrayBuffer | Uint8Array) => {
    // Electron may deliver as Uint8Array depending on version; normalize.
    const u8 = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (u8.byteLength % 2 !== 0) return;
    const view = new Int16Array(u8.buffer, u8.byteOffset, u8.byteLength / 2);
    transmitter.frame(view);
  });
  ipcMain.on(IPC_CHANNELS['voice.mic.stop'], () => transmitter.stop());

  // If the connection drops while transmitting, the transmitter's stop() will
  // be a no-op the next time setSpeaking is called on a destroyed connection;
  // wrap defensively so we don't surface noise.
  voice.on('state', (state) => {
    if (state.kind === 'idle' || state.kind === 'disconnected' || state.kind === 'error') {
      transmitter.stop();
    }
  });

  return voice;
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/voice.ts
git commit -m "feat(voice): wire MicTransmitter into IPC handlers"
```

---

## Task 7: AudioWorklet processor source

**Files:**
- Create: `src/renderer/lib/mic-worklet-source.ts`

The worklet runs in the audio thread; it cannot import other modules. We ship its source as a string so `MicCaptureManager` can build a blob URL.

- [ ] **Step 1: Write the worklet source module**

```ts
// src/renderer/lib/mic-worklet-source.ts
//
// AudioWorkletProcessor source. Runs in the audio thread. Receives 128-sample
// Float32 blocks from the input stream, accumulates them into 960-sample
// (20 ms @ 48 kHz) frames, applies gain, computes RMS, and posts each frame
// to the main thread as { rms, pcm } where pcm is an Int16Array buffer.
//
// The main thread decides whether to forward the frame to IPC (gate logic
// lives outside the audio thread so it can react to PTT key events without
// crossing thread boundaries).

export const MIC_WORKLET_SOURCE = /* js */ `
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._frame = new Float32Array(960);
    this._filled = 0;
    this._gain = 1;
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.gain === 'number') this._gain = e.data.gain;
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let read = 0;
    while (read < ch.length) {
      const need = 960 - this._filled;
      const take = Math.min(need, ch.length - read);
      for (let i = 0; i < take; i++) {
        this._frame[this._filled + i] = ch[read + i] * this._gain;
      }
      this._filled += take;
      read += take;
      if (this._filled === 960) {
        // Compute RMS and convert to Int16.
        let sumSq = 0;
        const pcm = new Int16Array(960);
        for (let i = 0; i < 960; i++) {
          const f = Math.max(-1, Math.min(1, this._frame[i]));
          sumSq += f * f;
          pcm[i] = Math.round(f * 32767);
        }
        const rms = Math.sqrt(sumSq / 960);
        this.port.postMessage({ rms, pcm: pcm.buffer }, [pcm.buffer]);
        this._filled = 0;
      }
    }
    return true;
  }
}
registerProcessor('botcord-mic', MicProcessor);
`;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/lib/mic-worklet-source.ts
git commit -m "feat(voice): mic AudioWorklet processor source"
```

---

## Task 8: MicCaptureManager (renderer)

**Files:**
- Create: `src/renderer/lib/mic-capture.ts`

This class owns the `MediaStream`, the `AudioWorkletNode`, the gate, and the IPC fan-out. It does NOT own settings — the consumer (the React hook) feeds it settings updates.

- [ ] **Step 1: Implement the manager**

```ts
// src/renderer/lib/mic-capture.ts
import { MIC_WORKLET_SOURCE } from './mic-worklet-source';
import {
  createVadGate,
  type VoiceInputSettings,
} from '../../shared/voice-input';

type Listener = (rms: number) => void;
type GateListener = (open: boolean) => void;

const FRAME_MS = 20;
const TAIL_MS = 200;
const TAIL_FRAMES = TAIL_MS / FRAME_MS; // 10

export class MicCaptureManager {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private settings: VoiceInputSettings | null = null;
  private gate = createVadGate({ threshold: 1, tailFrames: TAIL_FRAMES });
  private pttHeld = false;
  private gateOpen = false;
  private levelListeners = new Set<Listener>();
  private gateListeners = new Set<GateListener>();

  async start(settings: VoiceInputSettings): Promise<void> {
    if (this.ctx) await this.stop();
    this.settings = settings;
    this.gate = createVadGate({ threshold: settings.vadThreshold, tailFrames: TAIL_FRAMES });

    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: settings.inputDeviceId ?? undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 48_000,
      },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);

    this.ctx = new AudioContext({ sampleRate: 48_000 });
    const blob = new Blob([MIC_WORKLET_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'botcord-mic');
    this.node.port.postMessage({ gain: settings.inputGain });
    this.node.port.onmessage = (e) => this.onFrame(e.data as { rms: number; pcm: ArrayBuffer });
    source.connect(this.node);
    // Sink into the destination only if needed; we don't, so leave dangling.

    // Devices ending mid-call.
    this.stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => this.handleTrackEnded()));
  }

  async stop(): Promise<void> {
    if (this.gateOpen) {
      window.botcord.voice.micStop();
      this.gateOpen = false;
      this.emitGate(false);
    }
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) { await this.ctx.close().catch(() => {}); this.ctx = null; }
  }

  updateSettings(next: VoiceInputSettings): void {
    this.settings = next;
    this.gate = createVadGate({ threshold: next.vadThreshold, tailFrames: TAIL_FRAMES });
    this.node?.port.postMessage({ gain: next.inputGain });
  }

  setPttHeld(held: boolean): void { this.pttHeld = held; }

  onLevel(cb: Listener): () => void {
    this.levelListeners.add(cb);
    return () => this.levelListeners.delete(cb);
  }
  onGateChange(cb: GateListener): () => void {
    this.gateListeners.add(cb);
    return () => this.gateListeners.delete(cb);
  }

  private onFrame(data: { rms: number; pcm: ArrayBuffer }): void {
    const s = this.settings;
    if (!s) return;
    for (const l of this.levelListeners) l(data.rms);

    let shouldOpen = false;
    if (s.muted) shouldOpen = false;
    else if (s.mode === 'ptt') shouldOpen = this.pttHeld;
    else shouldOpen = this.gate.step(data.rms);

    if (shouldOpen && !this.gateOpen) {
      this.gateOpen = true;
      window.botcord.voice.micStart();
      this.emitGate(true);
    }
    if (shouldOpen) {
      window.botcord.voice.micFrame(data.pcm);
    }
    if (!shouldOpen && this.gateOpen) {
      this.gateOpen = false;
      window.botcord.voice.micStop();
      this.emitGate(false);
    }
  }

  private emitGate(open: boolean): void {
    for (const l of this.gateListeners) l(open);
  }

  private handleTrackEnded(): void {
    // Force gate closed and tear down. Consumer hook will re-acquire if asked.
    this.stop().catch(() => {});
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/lib/mic-capture.ts
git commit -m "feat(voice): MicCaptureManager (renderer)"
```

---

## Task 9: PTT global hotkey + window-blur safety

**Files:**
- Modify: main entry (search `globalShortcut` or `app.whenReady` to find the right file)

The main process registers/un-registers the accelerator and broadcasts PTT key events to the renderer. We use a `voice.setPttHeld` IPC event for that direction.

- [ ] **Step 1: Add channels for PTT events**

Edit `src/shared/ipc-contract.ts`:

```ts
  'voice.setPttBinding': 'voice.setPttBinding',
  'event.pttHeld': 'event.pttHeld',
```

Add to `BotcordApi.voice`:

```ts
    setPttBinding(accelerator: string | null): Promise<{ scope: 'global' | 'app'; downgraded: boolean }>;
    onPttHeld(cb: (held: boolean) => void): () => void;
```

Add to `src/preload/expose.ts`:

```ts
    setPttBinding: (accelerator) => invoke(IPC_CHANNELS['voice.setPttBinding'], accelerator),
    onPttHeld: (cb) => subscribe(IPC_CHANNELS['event.pttHeld'], cb as (p: unknown) => void),
```

- [ ] **Step 2: Implement registration in main**

Find the file where other `ipcMain.handle` registrations live for voice and add:

```ts
import { app, BrowserWindow, globalShortcut, powerMonitor } from 'electron';

let currentAccelerator: string | null = null;

function broadcastPtt(held: boolean): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC_CHANNELS['event.pttHeld'], held);
}

function tryRegisterGlobal(accelerator: string): boolean {
  try {
    return globalShortcut.register(accelerator, () => {
      // globalShortcut fires once per press; we synthesize "held" by pulsing
      // true then false on a short timer so a tap still produces audio.
      broadcastPtt(true);
      setTimeout(() => broadcastPtt(false), 250);
    });
  } catch { return false; }
}

ipcMain.handle(IPC_CHANNELS['voice.setPttBinding'], (_e, accelerator: unknown) => {
  if (currentAccelerator) globalShortcut.unregister(currentAccelerator);
  currentAccelerator = null;
  if (typeof accelerator !== 'string' || !accelerator) return { scope: 'app' as const, downgraded: false };
  const ok = tryRegisterGlobal(accelerator);
  if (ok) { currentAccelerator = accelerator; return { scope: 'global' as const, downgraded: false }; }
  return { scope: 'app' as const, downgraded: true };
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('browser-window-blur', () => broadcastPtt(false));
powerMonitor.on('suspend', () => broadcastPtt(false));
```

> Note on the "tap" behavior: Electron's `globalShortcut` does not expose key-down/key-up; it only fires on press. The 250 ms pulse ensures a single tap produces ≥ one Opus frame so Discord registers a speaking event. For a true held-down behavior with global scope, users on platforms where global key-state is exposed can be supported in a later iteration; for now, holding the key results in repeated fires — handle that by extending the pulse window each fire:

Replace the `register` callback with:

```ts
let pulseTimer: NodeJS.Timeout | null = null;
return globalShortcut.register(accelerator, () => {
  broadcastPtt(true);
  if (pulseTimer) clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => { broadcastPtt(false); pulseTimer = null; }, 250);
});
```

This collapses repeated fires into a single rolling open window. Document this trade-off in the settings UI tooltip.

- [ ] **Step 3: App-only fallback (renderer-side keydown)**

The renderer's `use-mic` hook (next task) will subscribe to `keydown`/`keyup` for the configured accelerator when `pttScope === 'app'` (either by user choice or downgrade). No main-process work needed here.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/expose.ts src/main/<edited-file>.ts
git commit -m "feat(voice): PTT global hotkey + blur/suspend safety"
```

---

## Task 10: `use-mic` hook (renderer)

**Files:**
- Create: `src/renderer/lib/use-mic.ts`

- [ ] **Step 1: Implement the hook**

```ts
// src/renderer/lib/use-mic.ts
import { useEffect, useRef, useState } from 'react';
import { MicCaptureManager } from './mic-capture';
import {
  DEFAULT_VOICE_INPUT_SETTINGS,
  type VoiceInputSettings,
} from '../../shared/voice-input';

export type MicState = {
  level: number;       // 0..1 RMS (smoothed for UI, ~20 Hz)
  gateOpen: boolean;   // are we transmitting right now
  permissionDenied: boolean;
};

export function useMic(opts: {
  enabled: boolean;            // true when connected to a voice channel
  settings: VoiceInputSettings;
  onPersist: (next: VoiceInputSettings) => void;
}): MicState {
  const [state, setState] = useState<MicState>({ level: 0, gateOpen: false, permissionDenied: false });
  const managerRef = useRef<MicCaptureManager | null>(null);

  // Lifecycle: start/stop based on enabled.
  useEffect(() => {
    if (!opts.enabled) return;
    const manager = new MicCaptureManager();
    managerRef.current = manager;

    manager.start(opts.settings).catch((err) => {
      if (err && typeof err === 'object' && 'name' in err && (err as DOMException).name === 'NotAllowedError') {
        setState((s) => ({ ...s, permissionDenied: true }));
      }
    });

    const offLevel = manager.onLevel((rms) => setState((s) => ({ ...s, level: rms })));
    const offGate = manager.onGateChange((open) => setState((s) => ({ ...s, gateOpen: open })));

    return () => {
      offLevel();
      offGate();
      manager.stop().catch(() => {});
      managerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled]);

  // Settings updates pushed to running manager.
  useEffect(() => {
    managerRef.current?.updateSettings(opts.settings);
  }, [opts.settings]);

  // PTT global event subscription.
  useEffect(() => {
    if (opts.settings.mode !== 'ptt') return;
    if (opts.settings.pttScope === 'global') {
      const off = window.botcord.voice.onPttHeld((held) => managerRef.current?.setPttHeld(held));
      return off;
    }
    // App-only fallback: bind keydown/keyup at window level.
    const accel = opts.settings.pttBinding?.accelerator ?? '';
    if (!accel) return;
    const matches = (e: KeyboardEvent) => acceleratorMatches(accel, e);
    const down = (e: KeyboardEvent) => { if (matches(e)) managerRef.current?.setPttHeld(true); };
    const up = (e: KeyboardEvent) => { if (matches(e)) managerRef.current?.setPttHeld(false); };
    const blur = () => managerRef.current?.setPttHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [opts.settings.mode, opts.settings.pttScope, opts.settings.pttBinding?.accelerator]);

  return state;
}

function acceleratorMatches(accel: string, e: KeyboardEvent): boolean {
  // "Control+Shift+Space" → require all listed modifiers + key
  const parts = accel.split('+').map((p) => p.trim());
  const key = parts.pop()!;
  const wantCtrl = parts.includes('Control') || parts.includes('CommandOrControl');
  const wantShift = parts.includes('Shift');
  const wantAlt = parts.includes('Alt') || parts.includes('Option');
  const wantMeta = parts.includes('Meta') || parts.includes('Command') || parts.includes('Super');
  if (e.ctrlKey !== wantCtrl) return false;
  if (e.shiftKey !== wantShift) return false;
  if (e.altKey !== wantAlt) return false;
  if (e.metaKey !== wantMeta) return false;
  return e.code === key || e.key === key;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/lib/use-mic.ts
git commit -m "feat(voice): useMic hook"
```

---

## Task 11: MicIndicator component

**Files:**
- Create: `src/renderer/components/voice/MicIndicator.tsx`

- [ ] **Step 1: Implement the indicator**

```tsx
// src/renderer/components/voice/MicIndicator.tsx
import { Mic, MicOff } from 'lucide-react';
import { cn } from '../../lib/cn';

export function MicIndicator(props: {
  muted: boolean;
  speaking: boolean;
  onClick?: () => void;
  title?: string;
}): JSX.Element {
  const Icon = props.muted ? MicOff : Mic;
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title ?? (props.muted ? 'Unmute' : 'Mute')}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition',
        props.muted && 'text-rose-400 hover:bg-rose-500/10',
        !props.muted && props.speaking && 'text-emerald-400 bg-emerald-500/10',
        !props.muted && !props.speaking && 'text-zinc-300 hover:bg-zinc-700/50',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
```

- [ ] **Step 2: Find the voice connection pill and embed the indicator**

Search for the existing connected-voice UI:

Run: `grep -rn "voice.leave\|voiceState\|getState()" src/renderer/components`

Identify the component that renders the active voice channel pill (likely near the channel list / status bar). In that component, add `useMic`-driven props:

```tsx
import { useMic } from '../lib/use-mic';
import { MicIndicator } from './voice/MicIndicator';
// ...inside the connected pill render branch:
const mic = useMic({
  enabled: voiceState.kind === 'connected',
  settings,                       // from prefs hook (Task 13)
  onPersist: persistVoiceInput,   // from prefs hook (Task 13)
});

<MicIndicator
  muted={settings.muted}
  speaking={mic.gateOpen}
  onClick={() => persistVoiceInput({ ...settings, muted: !settings.muted })}
/>
```

- [ ] **Step 3: Run the dev server and verify the icon renders**

Run: `npm run dev`
Expected: With a bot connected to a voice channel, the mic icon appears in the connection pill, grey when idle.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/voice/MicIndicator.tsx src/renderer/components/<edited-pill>.tsx
git commit -m "feat(voice): MicIndicator in connection pill"
```

---

## Task 12: VoiceInputSettings panel

**Files:**
- Create: `src/renderer/components/voice/VoiceInputSettings.tsx`
- Modify: settings route (search for existing settings page to add a tab/section)

- [ ] **Step 1: Implement the panel**

```tsx
// src/renderer/components/voice/VoiceInputSettings.tsx
import { useEffect, useState } from 'react';
import type { VoiceInputSettings } from '../../../shared/voice-input';

export function VoiceInputSettingsPanel(props: {
  settings: VoiceInputSettings;
  level: number;                 // live RMS for VU meter
  onChange: (next: VoiceInputSettings) => void;
}): JSX.Element {
  const { settings, level, onChange } = props;
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((all) =>
      setDevices(all.filter((d) => d.kind === 'audioinput')),
    );
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-medium mb-2">Input mode</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange({ ...settings, mode: 'va' })}
            className={modeBtn(settings.mode === 'va')}
          >Voice Activity</button>
          <button
            type="button"
            onClick={() => onChange({ ...settings, mode: 'ptt' })}
            className={modeBtn(settings.mode === 'ptt')}
          >Push to Talk</button>
        </div>
      </section>

      {settings.mode === 'va' && (
        <section>
          <h3 className="text-sm font-medium mb-2">Sensitivity</h3>
          <div className="relative h-3 bg-zinc-800 rounded overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-emerald-500/70 transition-[width] duration-75"
              style={{ width: `${Math.min(100, level * 100 * 4)}%` }}
            />
            <div
              className="absolute inset-y-0 w-px bg-yellow-300"
              style={{ left: `${settings.vadThreshold * 100 * 4}%` }}
            />
          </div>
          <input
            type="range" min={0} max={0.25} step={0.005}
            value={settings.vadThreshold}
            onChange={(e) => onChange({ ...settings, vadThreshold: Number(e.target.value) })}
            className="w-full mt-2"
          />
        </section>
      )}

      {settings.mode === 'ptt' && (
        <section>
          <h3 className="text-sm font-medium mb-2">Push-to-talk binding</h3>
          <PttBindingInput
            value={settings.pttBinding?.accelerator ?? null}
            onChange={async (accel) => {
              const result = await window.botcord.voice.setPttBinding(accel);
              onChange({
                ...settings,
                pttBinding: accel ? { accelerator: accel } : null,
                pttScope: result.scope,
                pttScopeDowngraded: result.downgraded,
              });
            }}
          />
          {settings.pttScopeDowngraded && (
            <p className="text-xs text-amber-400 mt-1">
              Global hotkey not available — falling back to in-app only.
              On macOS, grant Accessibility permission. On Wayland, global hotkeys are unsupported.
            </p>
          )}
        </section>
      )}

      <section>
        <h3 className="text-sm font-medium mb-2">Input device</h3>
        <select
          className="w-full bg-zinc-800 rounded px-2 py-1 text-sm"
          value={settings.inputDeviceId ?? ''}
          onChange={(e) => onChange({ ...settings, inputDeviceId: e.target.value || null })}
        >
          <option value="">System default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 6)}`}</option>
          ))}
        </select>
      </section>

      <section>
        <h3 className="text-sm font-medium mb-2">Input volume</h3>
        <input
          type="range" min={0} max={2} step={0.05}
          value={settings.inputGain}
          onChange={(e) => onChange({ ...settings, inputGain: Number(e.target.value) })}
          className="w-full"
        />
      </section>
    </div>
  );
}

function modeBtn(active: boolean): string {
  return `px-3 py-1.5 rounded text-sm ${active ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-300'}`;
}

function PttBindingInput(props: { value: string | null; onChange: (v: string | null) => void }): JSX.Element {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      const mods: string[] = [];
      if (e.ctrlKey) mods.push('Control');
      if (e.shiftKey) mods.push('Shift');
      if (e.altKey) mods.push('Alt');
      if (e.metaKey) mods.push('Meta');
      // Skip pure-modifier presses.
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.code;
      props.onChange([...mods, key].join('+'));
      setRecording(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [recording, props]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setRecording(true)}
        className="px-3 py-1.5 rounded text-sm bg-zinc-800 text-zinc-200 min-w-[8rem] text-left"
      >
        {recording ? 'Press a key…' : props.value ?? 'Set keybind'}
      </button>
      {props.value && !recording && (
        <button type="button" className="text-xs text-zinc-400" onClick={() => props.onChange(null)}>Clear</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount the panel in the existing settings UI**

Run: `grep -rn "Settings" src/renderer/routes`

Identify the settings route and add a section (or tab) labeled "Voice & Video" / "Voice Input" rendering `<VoiceInputSettingsPanel ... />` driven by the prefs hook.

- [ ] **Step 3: Run the dev server, click the panel**

Run: `npm run dev`
Expected: Panel renders. Mode toggle persists. With a voice connection live, the VU meter responds to mic input. PTT recorder captures a keybind. The `pttScopeDowngraded` warning shows when registration fails (force by entering an accelerator your OS reserves).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/voice/VoiceInputSettings.tsx src/renderer/routes/<settings-route>.tsx
git commit -m "feat(voice): voice input settings panel"
```

---

## Task 13: Persistence wiring (prefs hook → settings → main)

**Files:**
- Modify: wherever the settings route currently reads/writes `Prefs` (search for `prefs.set` / `prefs.get` usages on the renderer side).

The renderer reads `voiceInput` from prefs (defaulted via `DEFAULT_VOICE_INPUT_SETTINGS` if absent) and writes it back on change. The PTT binding side-effect already lives inside `VoiceInputSettingsPanel` (it calls `setPttBinding` before persisting), so the prefs path is plain JSON.

- [ ] **Step 1: Read with default fallback**

```ts
import { DEFAULT_VOICE_INPUT_SETTINGS, type VoiceInputSettings } from '../../shared/voice-input';

const settings: VoiceInputSettings = prefs?.voiceInput ?? DEFAULT_VOICE_INPUT_SETTINGS;

const persistVoiceInput = (next: VoiceInputSettings) => {
  setPrefs({ ...prefs, voiceInput: next });
};
```

- [ ] **Step 2: On app boot, re-register the saved PTT accelerator**

In the main entry, after prefs load and before window creation:

```ts
const stored = prefsRepo.get('voiceInput');
if (stored?.pttBinding?.accelerator) {
  // Fire-and-forget — registration result is reflected to the renderer
  // when it next calls setPttBinding via the settings UI.
  tryRegisterGlobal(stored.pttBinding.accelerator);
  // (currentAccelerator is set inside tryRegisterGlobal in Task 9.)
}
```

- [ ] **Step 3: Type-check + run dev server**

Run: `npx tsc --noEmit && npm run dev`
Expected: Settings persist across restarts. PTT binding survives restart and continues to fire globally on the next session.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/<settings-route>.tsx src/main/<entry>.ts
git commit -m "feat(voice): persist voice input settings, restore PTT on boot"
```

---

## Task 14: End-to-end manual verification

No code changes. Document the manual checklist; tick items as performed.

- [ ] **Step 1: Connect to a voice channel**

Launch dev (`npm run dev`), join a voice channel via the existing UI. Confirm `voiceState.kind === 'connected'`.

- [ ] **Step 2: Voice Activity loopback**

With another Discord client (or a second BotCord instance) listening in the same channel, talk into your mic. Expected: speaking indicator on the bot lights up on the listener side; audio is intelligible.

- [ ] **Step 3: VAD calibration**

In the settings panel, drag the threshold slider while speaking. Expected: the green bar crosses the yellow threshold marker exactly when transmission starts; gate-open lag ≤ one frame.

- [ ] **Step 4: PTT (global)**

Switch to PTT mode, set a binding (e.g. `Control+Shift+Space`). Move focus to another app and tap the binding. Expected: the bot transmits a brief burst (≥ one Opus frame), listeners see speaking indicator pulse.

- [ ] **Step 5: PTT downgrade**

Try a binding the OS reserves (e.g. `Control+Space` on macOS Spotlight). Expected: settings panel shows the amber downgrade warning; PTT still works when BotCord has focus.

- [ ] **Step 6: Mute toggle**

Click the mic icon in the connection pill. Expected: icon switches to red `MicOff`; transmission stops immediately even if PTT held / VAD open.

- [ ] **Step 7: Permission denied**

Revoke mic permission in OS settings, restart, connect to voice. Expected: "Microphone access denied" toast; receive still works; settings UI shows the disabled state.

- [ ] **Step 8: Device unplug**

Mid-call, unplug the mic (or disable in OS). Expected: gate closes; toast surfaced; reconnecting/changing device picks up cleanly.

- [ ] **Step 9: Connection drop**

Force-disconnect the bot from the voice channel via Discord (kick from voice). Expected: transmitter stops cleanly, no errors in the main log.

- [ ] **Step 10: Final commit (docs, if anything was tweaked during manual)**

```bash
git status
# If only verifications, no commit.
# If any minor fix landed during manual testing, commit it.
```

---

## Self-Review Notes

Spec coverage:
- Settings shape, defaults → Task 1.
- VAD gate (200 ms tail) → Task 2.
- `getConnection`, `setSelfMute` → Task 3.
- MicTransmitter (PCM → Opus → AudioPlayer, lifecycle) → Task 4.
- IPC channels + preload bridge → Task 5.
- IPC handlers, transmitter wiring, drop-on-disconnect → Task 6.
- AudioWorklet → Task 7.
- MicCaptureManager (gate, IPC fan-out, device-ended) → Task 8.
- Global PTT hotkey + blur/suspend safety + downgrade flag → Task 9.
- React `useMic` hook + app-only PTT fallback → Task 10.
- MicIndicator + connection pill integration → Task 11.
- Settings panel + VU meter + PTT recorder + downgrade UI → Task 12.
- Persistence + boot-time re-register → Task 13.
- Manual matrix (loopback, downgrade, mute, permission denied, device unplug, drop) → Task 14.

Type consistency: `VoiceInputSettings`, `PttBinding.accelerator`, `MicCaptureManager.start/stop/updateSettings/setPttHeld`, `MicTransmitter.start/frame/stop`, `voice.micStart/micFrame/micStop` — all referenced consistently across tasks.
