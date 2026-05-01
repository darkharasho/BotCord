# Voice & Video Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Voice & Video" Settings section with input/output device dropdowns (default to system default, persisted via prefs), wire output selection into the existing voice-sink, and provide tone/level-meter test affordances.

**Architecture:** New renderer-only `audio-devices` helper wraps `navigator.mediaDevices`. New `VoiceVideoSection` component reads/writes two new pref keys via the existing `api.prefs` store and the `useSaver` indicator. `voice-sink.ts` gains an initial `setSinkId` call on start and an exported `setVoiceSinkOutput` for live changes. No main-process or IPC changes — only adding two keys to `Prefs` and the main-process `VALID_KEYS` allow-list.

**Tech Stack:** Electron + React + TypeScript, Vitest + React Testing Library, Web Audio API (`AudioContext.setSinkId`, `OscillatorNode`, `AnalyserNode`), `navigator.mediaDevices` for enumeration and `getUserMedia`.

**Spec:** `docs/superpowers/specs/2026-05-01-voice-video-settings-design.md`

---

## File Structure

**Create:**
- `src/renderer/lib/audio-devices.ts` — enumeration, devicechange subscription, label-permission helper
- `src/renderer/components/settings/sections/VoiceVideoSection.tsx` — section UI
- `src/renderer/components/settings/__tests__/VoiceVideoSection.test.tsx` — section tests
- `src/renderer/lib/__tests__/voice-sink-output.test.ts` — `setVoiceSinkOutput` unit tests

**Modify:**
- `src/shared/domain.ts` — add `audioOutputDeviceId`, `audioInputDeviceId` to `Prefs`
- `src/main/ipc/prefs.ts` — add the two keys to `VALID_KEYS`
- `src/renderer/lib/voice-sink.ts` — initial `setSinkId` from prefs + exported `setVoiceSinkOutput`
- `src/renderer/components/settings/types.ts` — add `'voice'` to `SectionId` and to a `NAV_GROUPS` entry
- `src/renderer/components/settings/SettingsOverlay.tsx` — render `VoiceVideoSection`

---

## Task 1: Add prefs keys

**Files:**
- Modify: `src/shared/domain.ts:303-321` (Prefs type)
- Modify: `src/main/ipc/prefs.ts:8-16` (VALID_KEYS)

- [ ] **Step 1: Add keys to the `Prefs` type**

In `src/shared/domain.ts`, append two fields to the `Prefs` type (before the closing brace):

```ts
export type Prefs = {
  lastSelectedGuildId: string | null;
  lastSelectedChannelId: string | null;
  theme: 'dark';
  collapsedCategoryIds: string[];
  memberListOpen: boolean;
  channelLastSeen: Record<string, number>;
  mutedChannelIds: string[];
  giphyApiKey: string;
  autonomyGlobalEnabled: boolean;
  autonomyGlobalSystemPrompt: string;
  autonomyGlobalRateCapPerMin: number;
  autonomyVisionEnabled: boolean;
  autonomyModel: string;
  autonomyQueueMaxDepth: number;
  autonomyQueueTtlSeconds: number;
  closeToTray: boolean;
  closeToTrayHintShown: boolean;
  audioOutputDeviceId: string;
  audioInputDeviceId: string;
};
```

- [ ] **Step 2: Add keys to `VALID_KEYS`**

In `src/main/ipc/prefs.ts`, extend `VALID_KEYS`:

```ts
const VALID_KEYS: ReadonlyArray<keyof Prefs> = [
  'lastSelectedGuildId', 'lastSelectedChannelId', 'theme',
  'collapsedCategoryIds', 'memberListOpen', 'channelLastSeen',
  'mutedChannelIds', 'giphyApiKey',
  'autonomyGlobalEnabled', 'autonomyGlobalSystemPrompt', 'autonomyGlobalRateCapPerMin',
  'autonomyVisionEnabled', 'autonomyModel',
  'autonomyQueueMaxDepth', 'autonomyQueueTtlSeconds',
  'closeToTray', 'closeToTrayHintShown',
  'audioOutputDeviceId', 'audioInputDeviceId',
];
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no new errors).

- [ ] **Step 4: Commit**

```bash
git add src/shared/domain.ts src/main/ipc/prefs.ts
git commit -m "feat(prefs): add audioOutputDeviceId and audioInputDeviceId keys"
```

---

## Task 2: `audio-devices.ts` — enumeration + label-permission helper

**Files:**
- Create: `src/renderer/lib/audio-devices.ts`
- Test: (covered indirectly by `VoiceVideoSection.test.tsx` in Task 4 — this module is a thin wrapper around `navigator.mediaDevices`, no separate unit test)

- [ ] **Step 1: Create the helper module**

Create `src/renderer/lib/audio-devices.ts`:

```ts
// Renderer-side wrapper around navigator.mediaDevices for the Voice & Video
// settings section. Keeps the section component free of MediaDevices plumbing.

export type AudioDeviceLists = {
  outputs: MediaDeviceInfo[];
  inputs: MediaDeviceInfo[];
  // True when every audio device has a non-empty `label`. Chromium leaves
  // labels blank until the page has been granted microphone permission once.
  labelsAvailable: boolean;
};

export async function listAudioDevices(): Promise<AudioDeviceLists> {
  const all = await navigator.mediaDevices.enumerateDevices();
  const outputs = all.filter(d => d.kind === 'audiooutput');
  const inputs = all.filter(d => d.kind === 'audioinput');
  const audio = [...outputs, ...inputs];
  const labelsAvailable = audio.length === 0 || audio.every(d => d.label.length > 0);
  return { outputs, inputs, labelsAvailable };
}

export function subscribeDeviceChanges(cb: () => void): () => void {
  navigator.mediaDevices.addEventListener('devicechange', cb);
  return () => navigator.mediaDevices.removeEventListener('devicechange', cb);
}

// One-shot getUserMedia call. Stops every track on the resulting stream
// immediately — the only purpose is to unlock device labels for the rest of
// the session. Resolves false if the user denies the permission prompt.
export async function requestLabelPermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/lib/audio-devices.ts
git commit -m "feat(renderer): add audio-devices helper for Voice & Video settings"
```

---

## Task 3: Wire `voice-sink.ts` to honor the output device pref

**Files:**
- Modify: `src/renderer/lib/voice-sink.ts`
- Test: `src/renderer/lib/__tests__/voice-sink-output.test.ts` (new)

- [ ] **Step 1: Write the failing test for `setVoiceSinkOutput`**

Create `src/renderer/lib/__tests__/voice-sink-output.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to control voice-sink's module state across tests, so re-import
// fresh in each test via vi.resetModules().
beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('setVoiceSinkOutput', () => {
  it('is a no-op when the sink is not active', async () => {
    const mod = await import('../voice-sink');
    // No setSinkId call should be made; just resolves.
    await expect(mod.setVoiceSinkOutput('some-device-id')).resolves.toBeUndefined();
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/lib/__tests__/voice-sink-output.test.ts`
Expected: FAIL — `setVoiceSinkOutput` is not exported from `voice-sink.ts` yet.

- [ ] **Step 3: Update `voice-sink.ts` to read prefs and expose `setVoiceSinkOutput`**

Replace the contents of `src/renderer/lib/voice-sink.ts` with:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/lib/__tests__/voice-sink-output.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/voice-sink.ts src/renderer/lib/__tests__/voice-sink-output.test.ts
git commit -m "feat(voice-sink): honor audioOutputDeviceId pref and expose setVoiceSinkOutput"
```

---

## Task 4: `VoiceVideoSection` component (UI + tests)

**Files:**
- Create: `src/renderer/components/settings/sections/VoiceVideoSection.tsx`
- Create: `src/renderer/components/settings/__tests__/VoiceVideoSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/components/settings/__tests__/VoiceVideoSection.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceVideoSection } from '../sections/VoiceVideoSection';

const prefsGet = vi.fn();
const prefsSet = vi.fn().mockResolvedValue({ ok: true });

vi.mock('../../../lib/api', () => ({
  api: {
    prefs: {
      get: (k: string) => prefsGet(k),
      set: (k: string, v: unknown) => prefsSet(k, v),
    },
  },
}));

const setVoiceSinkOutput = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/voice-sink', () => ({
  setVoiceSinkOutput: (id: string) => setVoiceSinkOutput(id),
}));

const enumerateDevices = vi.fn();
const getUserMedia = vi.fn();
const addEventListener = vi.fn();
const removeEventListener = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  prefsGet.mockImplementation((k: string) =>
    Promise.resolve({ ok: true, data: k === 'audioOutputDeviceId' ? '' : '' }),
  );
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices,
      getUserMedia,
      addEventListener,
      removeEventListener,
    },
  });
});

const labeledDevices = () => [
  { kind: 'audiooutput', deviceId: 'speakers', label: 'Built-in Speakers', groupId: '' },
  { kind: 'audiooutput', deviceId: 'headset', label: 'USB Headset', groupId: '' },
  { kind: 'audioinput', deviceId: 'mic1', label: 'Built-in Mic', groupId: '' },
  { kind: 'videoinput', deviceId: 'cam', label: 'Webcam', groupId: '' },
] as MediaDeviceInfo[];

describe('VoiceVideoSection', () => {
  it('renders dropdowns from enumerated devices, with "Default" first', async () => {
    enumerateDevices.mockResolvedValue(labeledDevices());
    render(<VoiceVideoSection />);

    const outputSelect = await screen.findByLabelText('Output Device');
    const outputOptions = Array.from(outputSelect.querySelectorAll('option')).map(o => o.textContent);
    expect(outputOptions[0]).toMatch(/Default/);
    expect(outputOptions).toContain('Built-in Speakers');
    expect(outputOptions).toContain('USB Headset');

    const inputSelect = screen.getByLabelText('Input Device');
    const inputOptions = Array.from(inputSelect.querySelectorAll('option')).map(o => o.textContent);
    expect(inputOptions[0]).toMatch(/Default/);
    expect(inputOptions).toContain('Built-in Mic');
  });

  it('saves the output pref and applies it live when changed', async () => {
    enumerateDevices.mockResolvedValue(labeledDevices());
    render(<VoiceVideoSection />);

    const outputSelect = await screen.findByLabelText('Output Device');
    fireEvent.change(outputSelect, { target: { value: 'headset' } });

    await waitFor(() => {
      expect(prefsSet).toHaveBeenCalledWith('audioOutputDeviceId', 'headset');
      expect(setVoiceSinkOutput).toHaveBeenCalledWith('headset');
    });
  });

  it('saves the input pref when changed', async () => {
    enumerateDevices.mockResolvedValue(labeledDevices());
    render(<VoiceVideoSection />);

    const inputSelect = await screen.findByLabelText('Input Device');
    fireEvent.change(inputSelect, { target: { value: 'mic1' } });

    await waitFor(() => {
      expect(prefsSet).toHaveBeenCalledWith('audioInputDeviceId', 'mic1');
    });
  });

  it('shows a label-permission prompt when device labels are blank', async () => {
    enumerateDevices.mockResolvedValue([
      { kind: 'audiooutput', deviceId: 'a', label: '', groupId: '' },
      { kind: 'audioinput', deviceId: 'b', label: '', groupId: '' },
    ] as MediaDeviceInfo[]);
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    render(<VoiceVideoSection />);

    const button = await screen.findByRole('button', { name: /Show device names/i });
    enumerateDevices.mockResolvedValueOnce(labeledDevices());
    fireEvent.click(button);

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    });
  });

  it('re-enumerates on devicechange', async () => {
    enumerateDevices.mockResolvedValue(labeledDevices());
    render(<VoiceVideoSection />);
    await screen.findByLabelText('Output Device');

    const handler = addEventListener.mock.calls.find(([evt]) => evt === 'devicechange')?.[1];
    expect(typeof handler).toBe('function');

    enumerateDevices.mockClear();
    handler!();
    await waitFor(() => expect(enumerateDevices).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/settings/__tests__/VoiceVideoSection.test.tsx`
Expected: FAIL — module `'../sections/VoiceVideoSection'` does not exist.

- [ ] **Step 3: Create the section component**

Create `src/renderer/components/settings/sections/VoiceVideoSection.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { IconVolume, IconMicrophone, IconAlertTriangle } from '@tabler/icons-react';
import { api } from '../../../lib/api';
import { setVoiceSinkOutput } from '../../../lib/voice-sink';
import {
  listAudioDevices,
  requestLabelPermission,
  subscribeDeviceChanges,
  type AudioDeviceLists,
} from '../../../lib/audio-devices';
import { SelectField } from '../fields/SelectField';
import { useSaver } from '../SavingState';
import { SectionHeader } from './AccountSection';
import { pushToast } from '../../Toaster';

const DEFAULT_VALUE = '';
const DEFAULT_LABEL = 'Default (system)';

export function VoiceVideoSection() {
  const [devices, setDevices] = useState<AudioDeviceLists | null>(null);
  const [outputId, setOutputId] = useState<string>(DEFAULT_VALUE);
  const [inputId, setInputId] = useState<string>(DEFAULT_VALUE);
  const [toneBusy, setToneBusy] = useState(false);
  const [micTesting, setMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [permRequested, setPermRequested] = useState(false);
  const { trigger } = useSaver();

  const refresh = async () => setDevices(await listAudioDevices());

  useEffect(() => {
    refresh();
    const off = subscribeDeviceChanges(() => { refresh(); });
    return off;
  }, []);

  useEffect(() => {
    api.prefs.get('audioOutputDeviceId').then(r => {
      if (r.ok && typeof r.data === 'string') setOutputId(r.data);
    });
    api.prefs.get('audioInputDeviceId').then(r => {
      if (r.ok && typeof r.data === 'string') setInputId(r.data);
    });
  }, []);

  const onChangeOutput = (next: string) => {
    let previous = '';
    setOutputId(prev => { previous = prev; return next; });
    trigger(api.prefs.set('audioOutputDeviceId', next));
    setVoiceSinkOutput(next).catch(() => {
      pushToast('danger', "Couldn't switch output — device may be unplugged.");
      setOutputId(previous);
      trigger(api.prefs.set('audioOutputDeviceId', previous));
    });
  };

  const onChangeInput = (next: string) => {
    setInputId(next);
    trigger(api.prefs.set('audioInputDeviceId', next));
  };

  const onShowLabels = async () => {
    setPermRequested(true);
    const ok = await requestLabelPermission();
    if (!ok) {
      pushToast('warn', 'Microphone access denied. You can enable it in your OS settings.');
      return;
    }
    await refresh();
  };

  if (!devices) return null;

  const outputOptions = [
    { value: DEFAULT_VALUE, label: DEFAULT_LABEL },
    ...devices.outputs.map(d => ({ value: d.deviceId, label: d.label || `Output ${d.deviceId.slice(0, 6)}` })),
  ];
  const inputOptions = [
    { value: DEFAULT_VALUE, label: DEFAULT_LABEL },
    ...devices.inputs.map(d => ({ value: d.deviceId, label: d.label || `Input ${d.deviceId.slice(0, 6)}` })),
  ];

  return (
    <div className="max-w-2xl space-y-8">
      <SectionHeader title="Voice & Video" subtitle="Choose which devices BotCord uses for voice playback and capture." />

      {!devices.labelsAvailable && !permRequested && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-warn/40 bg-warn/10">
          <IconAlertTriangle size={18} className="text-warn shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm text-fg font-medium">Allow microphone access to see device names</div>
            <p className="text-xs text-fg-muted mt-0.5">BotCord won't record anything — this just unlocks the device labels.</p>
            <button
              onClick={onShowLabels}
              className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors"
            >
              Show device names
            </button>
          </div>
        </div>
      )}

      <Subsection title="Output (Speakers)" icon={<IconVolume size={14} className="text-accent" />}>
        <SelectField
          label="Output Device"
          value={outputId}
          onChange={onChangeOutput}
          options={outputOptions}
        />
        <button
          onClick={() => playTestTone(outputId, () => setToneBusy(false), () => setToneBusy(true))}
          disabled={toneBusy}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-bg-input text-xs font-medium text-fg hover:border-accent/50 disabled:opacity-50 transition-colors"
        >
          {toneBusy ? 'Playing…' : 'Test speaker'}
        </button>
      </Subsection>

      <Subsection title="Input (Microphone)" icon={<IconMicrophone size={14} className="text-accent" />} hint="Used when BotCord gains microphone features.">
        <SelectField
          label="Input Device"
          value={inputId}
          onChange={onChangeInput}
          options={inputOptions}
        />
        <MicTester
          deviceId={inputId}
          active={micTesting}
          level={micLevel}
          onToggle={setMicTesting}
          onLevel={setMicLevel}
        />
      </Subsection>
    </div>
  );
}

function Subsection({ title, icon, hint, children }: { title: string; icon: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1.5">
        {icon}
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-dim">{title}</h3>
      </div>
      {hint && <p className="text-xs text-fg-muted">{hint}</p>}
      {children}
    </section>
  );
}

async function playTestTone(deviceId: string, onEnd: () => void, onStart: () => void) {
  onStart();
  const ac = new AudioContext();
  try {
    const ctxAny = ac as unknown as { setSinkId?: (id: string) => Promise<void> };
    if (deviceId && typeof ctxAny.setSinkId === 'function') {
      await ctxAny.setSinkId(deviceId);
    }
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0, ac.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, ac.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, ac.currentTime + 0.4);
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + 0.42);
    osc.onended = () => { ac.close(); onEnd(); };
  } catch (e) {
    console.warn('[voice-test] tone failed', e);
    await ac.close();
    onEnd();
  }
}

function MicTester({
  deviceId, active, level, onToggle, onLevel,
}: {
  deviceId: string;
  active: boolean;
  level: number;
  onToggle: (v: boolean) => void;
  onLevel: (v: number) => void;
}) {
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) { onLevel(0); return; }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const ac = new AudioContext();
        ctxRef.current = ac;
        const src = ac.createMediaStreamSource(stream);
        const analyser = ac.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          if (cancelled) return;
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
          const rms = Math.sqrt(sum / buf.length);
          onLevel(Math.min(1, rms * 4));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        onToggle(false);
      }
    })();
    return () => {
      cancelled = true;
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      ctxRef.current?.close().catch(() => { /* best-effort */ });
      ctxRef.current = null;
      onLevel(0);
    };
  }, [active, deviceId, onLevel, onToggle]);

  return (
    <div className="space-y-2">
      <button
        onClick={() => onToggle(!active)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-bg-input text-xs font-medium text-fg hover:border-accent/50 transition-colors"
      >
        {active ? 'Stop mic test' : 'Test microphone'}
      </button>
      {active && (
        <div className="h-2 w-full max-w-sm rounded-full bg-bg-sunken overflow-hidden">
          <div
            className="h-full bg-accent transition-[width] duration-75"
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/settings/__tests__/VoiceVideoSection.test.tsx`
Expected: PASS (all 5 tests).

If a test fails on `Toaster`/`pushToast` (jsdom missing animation APIs), add a small mock at the top of the test file:

```ts
vi.mock('../../Toaster', () => ({ pushToast: vi.fn() }));
```

- [ ] **Step 5: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/settings/sections/VoiceVideoSection.tsx \
        src/renderer/components/settings/__tests__/VoiceVideoSection.test.tsx
git commit -m "feat(settings): add Voice & Video section with device dropdowns and tests"
```

---

## Task 5: Wire the section into the Settings overlay

**Files:**
- Modify: `src/renderer/components/settings/types.ts`
- Modify: `src/renderer/components/settings/SettingsOverlay.tsx`

- [ ] **Step 1: Add `'voice'` to `SectionId` and the nav group**

Replace `src/renderer/components/settings/types.ts` with:

```ts
import {
  IconUser,
  IconPlug,
  IconPalette,
  IconBell,
  IconHeadphones,
  IconSparkles,
  IconServer,
  IconInfoCircle,
  type Icon,
} from '@tabler/icons-react';

export type SectionId =
  | 'account'
  | 'connections'
  | 'appearance'
  | 'notifications'
  | 'voice'
  | 'autonomy'
  | 'servers'
  | 'about';

export type NavGroup = {
  label: string;
  items: { id: SectionId; label: string; icon: Icon }[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'User Settings',
    items: [
      { id: 'account', label: 'Account', icon: IconUser },
      { id: 'connections', label: 'Connections', icon: IconPlug },
    ],
  },
  {
    label: 'App Settings',
    items: [
      { id: 'appearance', label: 'Appearance', icon: IconPalette },
      { id: 'notifications', label: 'Notifications', icon: IconBell },
      { id: 'voice', label: 'Voice & Video', icon: IconHeadphones },
      { id: 'autonomy', label: 'Autonomy', icon: IconSparkles },
      { id: 'servers', label: 'Servers', icon: IconServer },
      { id: 'about', label: 'About', icon: IconInfoCircle },
    ],
  },
];

export const DEFAULT_SECTION: SectionId = 'account';
```

- [ ] **Step 2: Render the section in the overlay**

In `src/renderer/components/settings/SettingsOverlay.tsx`:

Add the import beside the other section imports:

```ts
import { VoiceVideoSection } from './sections/VoiceVideoSection';
```

Add the conditional render between Notifications and Autonomy (preserve order):

```tsx
{active === 'notifications' && <NotificationsSection />}
{active === 'voice' && <VoiceVideoSection />}
{active === 'autonomy' && <AutonomySection />}
```

- [ ] **Step 3: Run the existing overlay tests**

Run: `npx vitest run src/renderer/components/settings/__tests__/SettingsOverlay.test.tsx`
Expected: PASS — existing tests don't depend on the new section.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/types.ts src/renderer/components/settings/SettingsOverlay.tsx
git commit -m "feat(settings): wire Voice & Video section into the overlay"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Manual QA (record findings, do not fix here)**

Start the dev server and:

1. Open Settings → Voice & Video. Verify both dropdowns show "Default (system)" first and your real devices.
2. If labels are blank, click "Show device names", grant permission, confirm labels populate.
3. Pick a non-default output. Click "Test speaker" — confirm tone plays through that device.
4. Toggle "Test microphone" — confirm the level meter responds.
5. Plug/unplug a USB audio device and confirm the dropdown list updates without reload.
6. Join a voice channel from the channel list. Change the output dropdown — confirm playback routes to the new device immediately.
7. Quit/restart BotCord, reopen Settings → Voice & Video, confirm previously-selected devices are still selected.

If any step fails, file follow-up tasks rather than amending this plan.

---

## Self-Review Notes

- **Spec coverage:** §Scope (in/out) → Tasks 4–5; §Persistence → Task 1; §Wiring → Task 3; §Components & files → Tasks 2, 4, 5; §Testing → Tasks 3 (voice-sink unit), 4 (section), 6 (manual). §Error handling: stale-pref clearing on initial sink → Task 3; setSinkId failure on change → Task 4 (`onChangeOutput` catch); getUserMedia denial → Task 4 (`onShowLabels`, `MicTester` `onToggle(false)`).
- **Type consistency:** `setVoiceSinkOutput(deviceId: string): Promise<void>` is used identically in voice-sink (Task 3), tests (Task 3), and the section (Task 4). `audioOutputDeviceId` / `audioInputDeviceId` keys are spelled the same in all three call sites.
- **Open question** (from spec): `AudioContext.setSinkId` requires Chromium 110+. The `applySinkId` helper uses an `if (typeof ... === 'function')` guard so the code compiles and runs even on a hypothetical older Electron — it just silently keeps default routing. If the QA in Task 6 step 3 shows tones never switching device, the fallback is `<audio>` element + `HTMLMediaElement.setSinkId` (broader support). That fallback is out of scope for this plan unless needed.
