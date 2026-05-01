# Voice & Video settings — design

## Summary

Add a "Voice & Video" section to Settings with input (microphone) and output (speaker) device dropdowns. Both default to the system default and can be changed via dropdown. The output selection wires into the existing voice-sink today (BotCord can already join voice channels and listen). The input selection is persisted now; its consumer will be a future microphone feature.

Each side gets a Test affordance: a tone for the output, a live level meter for the input.

## Motivation

BotCord can join Discord voice channels and play back the mixed PCM stream through `src/renderer/lib/voice-sink.ts`. Today playback always goes to the default audio output. Users on multi-device setups (USB headset + speakers, multiple monitors with audio) need to route it explicitly. Microphone selection is shipped at the same time as groundwork for upcoming voice features and so users can pre-configure their preferred device.

## Scope

In:
- New Settings section "Voice & Video".
- Output and input device dropdowns, each defaulting to "Default (system)".
- Live updates to the device list when devices are plugged/unplugged.
- Output dropdown changes apply immediately to an active voice-sink via `AudioContext.setSinkId`.
- Test speaker button (440 Hz, 0.4 s tone through selected sink).
- Test microphone toggle with a live level meter (RMS, AnalyserNode).
- One-shot microphone permission prompt to unlock device labels.

Out:
- Microphone consumer / sending audio to a voice channel (future work).
- Video device handling (the section is named Voice & Video for forward-compat, but only audio ships now).
- Per-server overrides, push-to-talk, noise suppression, AGC.
- OS-level default-device tracking after the user has explicitly chosen a device.

## User-visible behavior

Section sits in the sidebar between Notifications and Autonomy, with `IconHeadphones`.

Layout:

1. **Output Device** group
   - `SelectField` with options: `Default (system)` + each enumerated `audiooutput`.
   - "Test speaker" button beside or below the field. Plays a short tone through the selected sink. Disabled while a tone is already playing.
2. **Input Device** group
   - `SelectField` with options: `Default (system)` + each enumerated `audioinput`.
   - "Test microphone" toggle. When on, a horizontal level-meter bar (0–100%) animates in real time. Toggle off stops the stream.
   - Helper text: "Used when BotCord gains microphone features."
3. **Label-permission prompt** (only when at least one device has an empty label)
   - Inline notice: "Allow microphone access to see device names. BotCord won't record anything."
   - Button "Show device names" → calls `getUserMedia({ audio: true })`, immediately stops the resulting tracks, then re-enumerates.

If a previously-saved device is no longer present, the dropdown falls back to "Default (system)" visually but does not silently rewrite the pref unless the user changes the selection or `setSinkId` actually fails (see §Wiring).

## Persistence

Two new keys in the existing `api.prefs` string store:

- `audioOutputDeviceId: string` — empty string means system default.
- `audioInputDeviceId: string` — empty string means system default.

Read with `api.prefs.get`, written via `useSaver().trigger(api.prefs.set(...))` so the header saving indicator lights up. Pattern matches `NotificationsSection`.

No migration: `api.prefs.get` already returns `{ ok, data }` and we treat `undefined` → `''`.

## Wiring

`src/renderer/lib/voice-sink.ts` is updated:

1. `startVoiceSink()` reads `audioOutputDeviceId` from prefs. If non-empty, awaits `ctx.setSinkId(deviceId)` before `node.connect(ctx.destination)`. If `setSinkId` rejects (device gone), logs a warning, calls `api.prefs.set('audioOutputDeviceId', '')` to clear the stale pref, and proceeds with default routing.
2. New export `setVoiceSinkOutput(deviceId: string): Promise<void>`. If `ctx` is active, calls `ctx.setSinkId(deviceId || '')`. If not active, no-op — the next `startVoiceSink` will pick up the new pref. Errors are logged and surfaced to the caller as a rejected promise so the Settings section can show a transient toast.

Input has no consumer wiring this PR. Writing the pref is the only behavior.

## Components & files

```
src/renderer/components/settings/sections/
  VoiceVideoSection.tsx          (new)
src/renderer/lib/
  audio-devices.ts               (new)
  voice-sink.ts                  (modified)
src/renderer/components/settings/
  types.ts                       (modified — add 'voice' to SectionId + nav group)
  SettingsOverlay.tsx            (modified — render <VoiceVideoSection />)
  SettingsSidebar.tsx            (modified — IconHeadphones entry)
```

### `audio-devices.ts`

Pure renderer module wrapping `navigator.mediaDevices`:

- `listAudioDevices(): Promise<{ outputs: MediaDeviceInfo[]; inputs: MediaDeviceInfo[]; labelsAvailable: boolean }>`
  - Calls `enumerateDevices`, partitions by `kind`. `labelsAvailable` is `true` when every returned audio device has a non-empty `label`.
- `subscribeDeviceChanges(cb: () => void): () => void`
  - Adds a `devicechange` listener and returns an unsubscribe function.
- `requestLabelPermission(): Promise<boolean>`
  - Calls `getUserMedia({ audio: true })`, immediately stops every track on the returned stream, returns `true`. On rejection (user denied) returns `false`.

### `VoiceVideoSection.tsx`

Owns:
- `outputs`, `inputs`, `labelsAvailable` state, refreshed on mount and on `devicechange`.
- `outputId`, `inputId` state, hydrated from prefs on mount.
- Save handler per dropdown: writes the pref via `useSaver().trigger`, and for the output, also calls `setVoiceSinkOutput`.
- Tone-test handler: creates an `AudioContext`, calls `setSinkId(outputId)`, schedules an `OscillatorNode` (440 Hz, gain envelope 0 → 0.2 → 0 over ~0.4 s), closes the context after the tone ends.
- Mic-test handler: when toggled on, calls `getUserMedia({ audio: { deviceId: inputId || undefined } })`, pipes into an `AnalyserNode`, runs an `requestAnimationFrame` loop computing RMS, drives a level-bar component. On toggle off (or unmount), stops tracks and closes context.

State machines stay simple — no concurrent tone tests, mic test is a single boolean.

## Error handling

- `setSinkId` failure on initial sink creation: log, clear stale pref, fall back to default. Voice playback still works.
- `setSinkId` failure on dropdown change: rejected promise from `setVoiceSinkOutput`; section catches and shows a transient inline error ("Couldn't switch to that device — it may have been unplugged.") and reverts the dropdown.
- `getUserMedia` rejection in label prompt or mic test: show inline error "Microphone access denied. You can enable it in your OS settings." Don't retry automatically.
- `enumerateDevices` rejection (extremely rare): show "Could not list audio devices" and retry button.

## Testing

Renderer tests follow the existing settings test pattern (`src/renderer/components/settings/__tests__/`).

- **`VoiceVideoSection.test.tsx`** (new)
  - Mocks `navigator.mediaDevices.enumerateDevices` / `getUserMedia` / `addEventListener('devicechange', ...)`.
  - Renders dropdowns from mocked devices, default-device row first.
  - Clicking an output option calls `api.prefs.set('audioOutputDeviceId', ...)` and `setVoiceSinkOutput`.
  - When `enumerateDevices` returns empty labels, the permission prompt renders. Clicking the button calls `getUserMedia` once and re-enumerates.
  - `devicechange` event re-runs enumeration.
  - Tone-test button is disabled while playing.
- **`voice-sink.ts`** is exercised indirectly today; we add a small unit around `setVoiceSinkOutput` (sink-id pass-through, no-op when inactive).

Manual QA: plug/unplug a USB headset with the section open, confirm dropdowns update; pick the headset, join a voice channel, confirm audio routes; pull the headset and confirm fallback.

## Risks / open questions

- `AudioContext.setSinkId` is Chromium 110+. Electron version in use should support it; verify against `package.json` electron pin during implementation. If unsupported on the current Electron, fall back to creating an `<audio>` element sink (uses `HTMLMediaElement.setSinkId`, broader support) — this is a backup plan, not the default.
- macOS in particular may keep stale labels after permission revoke. The label-prompt UX assumes labels stick once granted; if not, the prompt re-appears on next mount, which is acceptable.
- "Default" is a sentinel — we don't track the OS default device id and re-write it on change. If the user picks "Default" they get whatever the OS hands us at sink-creation time. This matches Discord's behavior.
