# Voice Input — Mic Relay Through Bot

**Date:** 2026-05-01
**Status:** Design — pending implementation plan

## Problem

BotCord currently joins voice channels in listen-only mode (`selfMute: true`), decoding and mixing incoming audio for the user. There is no way for the user to *speak* through the bot. We want to add a mic-input path that funnels the user's microphone audio out through the connected bot, with Discord-style ergonomics: a togglable mode (push-to-talk vs. voice activity), a configurable PTT keybind, an input device picker, an input volume slider, mute control, and a speaking indicator.

## Scope

**In scope (v1, "Discord-parity"):**
- PTT vs. Voice Activity mode toggle
- PTT keybind: global by default, app-only fallback when global registration fails
- Adjustable VAD threshold with live VU meter for calibration
- Input device picker, input volume (gain) slider
- Mute/unmute while connected
- Speaking indicator: mic icon in the connection pill + bot avatar speaking ring
- App-global settings (not per-bot)

**Out of scope:**
- Noise suppression, AGC, echo cancellation beyond what `getUserMedia` provides natively (`echoCancellation: true, noiseSuppression: true`)
- Push-to-mute as a separate mode
- Per-bot voice input settings
- Bundling RNNoise or similar WASM models

## Constraints

- The bot joined with `selfMute: true` for the existing receive pipeline. We must flip it `false` only while transmitting; otherwise Discord suppresses speaking events from muted users and listeners won't see the bot light up.
- Listeners will always see "Bot is speaking" — we can't impersonate the user. This is a known UX limitation, not a bug.
- macOS global hotkeys require Accessibility / Input Monitoring permission.
- Wayland (Linux) does not reliably support global hotkeys via Electron's `globalShortcut`.
- The existing `prism-media` opus *decoder* is loaded via native module; the *encoder* is the same package and may share its load failure modes.

## Architecture

A new `MicCaptureManager` lives in the **renderer** (only place with `getUserMedia` access). It owns the `MediaStream`, runs an `AudioWorklet` that produces 20 ms / 48 kHz mono Float32 frames, computes RMS for the VU meter and VAD gate, and ships gated frames as Int16 PCM over IPC.

A new `MicTransmitter` in the **main** process owns the outbound side: receives PCM frames, feeds them into a `prism.opus.Encoder` via a `Readable`, wraps that in `createAudioResource({ inputType: StreamType.Opus })`, and plays it through an `AudioPlayer` subscribed to the existing `VoiceConnection`. It also flips `connection.setSpeaking(true/false)` and the `selfMute` flag in lockstep with the gate.

The existing `VoiceManager` is unchanged in shape. It gains a `getConnection()` accessor and a `setSelfMute(b)` method (implemented via `connection.rejoin({ selfMute })`). Receive (decoder/mixer) keeps running unchanged in parallel; the same `VoiceConnection` carries both directions.

**Settings** live in the existing prefs repo (`src/main/db/repos/prefs.ts`) as a single `voiceInput` JSON blob:

```ts
type VoiceInputSettings = {
  mode: 'ptt' | 'va';
  pttBinding: { key: string; modifiers: string[] } | null;
  pttScope: 'global' | 'app';
  pttScopeDowngraded: boolean; // set true if 'global' was requested but registration failed
  vadThreshold: number;        // 0..1 RMS
  inputDeviceId: string | null; // null = system default
  inputGain: number;           // 0..2 multiplier, default 1
  muted: boolean;
};
```

## Data Flow

```
┌─ Renderer ─────────────────────────────────────────────┐
│ getUserMedia → MediaStreamSource → AudioWorklet        │
│   ├─ resample/downmix to 48k mono                      │
│   ├─ apply input gain                                  │
│   ├─ compute RMS → emit `mic.level` event (UI/VU)      │
│   └─ frame buffer (20ms / 960 samples Int16)           │
│                                                        │
│ Gate decision (per frame):                             │
│   • PTT mode: gate = isHotkeyHeld                      │
│   • VA mode:  gate = rms > threshold (with 200ms tail) │
│   • muted:    gate = false                             │
│                                                        │
│ Edge-triggered: gate open → ipc.send('mic.start')      │
│ While open:    ipc.send('mic.frame', Int16Array)       │
│ Gate close:    ipc.send('mic.stop')                    │
└────────────────────────────────────────────────────────┘
            │ IPC (preload bridge)
            ▼
┌─ Main ─────────────────────────────────────────────────┐
│ MicTransmitter                                         │
│   on 'start':                                          │
│     - new prism.opus.Encoder + Readable                │
│     - createAudioResource(StreamType.Opus)             │
│     - audioPlayer.play(resource)                       │
│     - connection.setSpeaking(true)                     │
│     - voiceManager.setSelfMute(false)                  │
│   on 'frame': pushable.push(int16Buffer)               │
│   on 'stop':                                           │
│     - pushable.push(null) → encoder/player drain       │
│     - connection.setSpeaking(false)                    │
│     - voiceManager.setSelfMute(true)                   │
└────────────────────────────────────────────────────────┘
```

**Why edge-triggered start/stop:** Spinning up a fresh Opus encoder per PTT press / VAD opening is cheap and avoids buffered-audio tail-play. A long-lived stream gated by zero-fills would cause lingering audio after release.

**Why `setSelfMute` toggling:** Discord suppresses speaking events from `selfMute: true` users. We flip false only while transmitting so listeners see the speaking indicator.

## Components & Files

### New files
- `src/renderer/lib/mic-capture.ts` — `MicCaptureManager` class. Owns `MediaStream`, the `AudioWorklet`, gate state, hotkey listener registration. Exposes `start(settings)`, `stop()`, `setMuted(b)`, `updateSettings(partial)`, and event emitters for `level` (per-frame RMS, throttled to ~20 Hz for UI) and `gateChange`.
- `src/renderer/lib/mic-worklet.ts` — `AudioWorkletProcessor` source as a string/blob URL. Float32 in → Int16 out, 20 ms framing, RMS calc.
- `src/main/voice/mic-transmitter.ts` — `MicTransmitter` class. PCM stream → opus encoder → `AudioPlayer` → `VoiceConnection`. Handles start/frame/stop lifecycle.
- `src/renderer/components/voice/VoiceInputSettings.tsx` — settings panel: mode toggle, PTT recorder, threshold slider with live VU, device picker, gain slider.
- `src/renderer/components/voice/MicIndicator.tsx` — green-when-transmitting mic icon for the connection pill.
- `src/renderer/lib/use-mic.ts` — React hook wrapping `MicCaptureManager` lifecycle + settings sync.

### Modified files
- `src/main/voice/voice-manager.ts` — add `getConnection()`, `setSelfMute(b)` (calls `connection.rejoin({ selfMute })`).
- `src/main/ipc/voice.ts` — register `mic.start` / `mic.frame` / `mic.stop` IPC channels; instantiate `MicTransmitter` alongside `VoiceManager`.
- `src/shared/ipc-contract.ts` — add the three new channels.
- `src/preload/index.ts` — bridge the channels (frame channel needs `Buffer`/`ArrayBuffer` passthrough).
- `src/main/db/repos/prefs.ts` — add `voiceInput` blob accessors.
- `src/main/index.ts` (or wherever `globalShortcut` lives) — register PTT global hotkey when settings load; re-register on change; fall back to in-renderer `keydown` listener if `globalShortcut.register` returns false (set `pttScopeDowngraded: true`).
- The existing voice connection pill component — embed `MicIndicator`; bot avatar ring driven by local gate state (no IPC roundtrip needed).

## Error Handling & Edge Cases

- **Mic permission denied / no device** — `getUserMedia` rejects. Surface a non-blocking toast "Microphone access denied — voice input disabled". Voice receive keeps working. Settings UI shows a "Re-request access" button.
- **Device unplugged mid-call** — `MediaStreamTrack` emits `ended`. Stop the gate, toast the user, attempt re-acquire with the saved `inputDeviceId`; fall back to system default.
- **Global hotkey registration fails** (Wayland, macOS without permission, conflict) — `globalShortcut.register` returns false. Silently downgrade to app-only scope, set `pttScopeDowngraded: true`, show a warning icon in settings with a tooltip explaining why.
- **Not connected to a voice channel** — mic capture stays inert; the gate can open but `MicTransmitter` no-ops if `voiceManager.getConnection()` is null. No errors surfaced — expected idle state.
- **Voice connection drops mid-transmit** — `VoiceConnection` state goes `Disconnected`. Transmitter stops the player, clears the encoder; renderer sees `voiceState` flip and pauses gating until reconnected.
- **Opus encoder fails to load** — surface the same `voiceState: error` path the receive side uses. The encoder is instantiated lazily on first transmit so the receive pipeline isn't taken down preemptively.
- **PTT key held when window loses focus / system sleeps** — `blur` and `powerMonitor.suspend` handlers force gate closed.
- **VAD threshold set to 0** — equivalent to open-mic. Valid setting, allowed.
- **Rapid PTT tap (sub-frame)** — debounce gate-close by one frame (20 ms) so a tap still produces at least one Opus packet; otherwise Discord suppresses the speaking event entirely.

## Testing

### Unit (vitest)
- `MicTransmitter`: feed canned PCM, assert opus encoder receives expected byte counts; assert `setSpeaking` / `setSelfMute` lifecycle on start/stop.
- VAD gate logic (extracted as a pure function): given an RMS sequence and threshold, assert open/close edges including the 200 ms tail.
- Settings serialization round-trip in the prefs repo.

### Integration
- Hotkey downgrade path: mock `globalShortcut.register → false`, assert settings get marked `pttScope: 'app'`, `pttScopeDowngraded: true`.
- IPC contract: `mic.start` → `mic.frame * N` → `mic.stop` produces exactly one `AudioPlayer.play` call and one transition through `Idle` afterward.

### Manual
- Two-bot loopback: bot A transmits via BotCord, bot B (or a second BotCord instance) receives — confirm audio is intelligible end-to-end.
- VU meter calibration: drag slider while talking, confirm gate opens/closes match the visual cross-threshold.
- macOS Accessibility permission prompt flow.
- Wayland fallback to app-only scope (manual on a Linux Wayland session).

## Known Limitations

- Listeners always see "Bot is speaking" rather than the user's name. Unavoidable — it is the bot's voice session.
- Latency is ~mic frame (20 ms) + IPC + opus encode + Discord uplink ≈ 200–500 ms vs. a native client. Acceptable for an admin tool, not for music or rhythm games.
- Wayland users lose global PTT and degrade to app-only. Documented in settings UI.
