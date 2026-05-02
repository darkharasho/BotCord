import { useEffect, useRef, useState } from 'react';
import { MicCaptureManager } from './mic-capture';
import {
  type VoiceInputSettings,
} from '../../shared/voice-input';
import { playVoiceSound } from './voice-sounds';

export type MicState = {
  level: number;       // 0..1 RMS (~20 Hz updates from worklet)
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
    let aborted = false;

    manager.start(opts.settings).then(
      () => {
        // If cleanup ran before start() resolved (e.g. React StrictMode
        // double-invocation), tear down the resources we just acquired.
        if (aborted) manager.stop().catch(() => {});
      },
      (err) => {
        if (err && typeof err === 'object' && 'name' in err && (err as DOMException).name === 'NotAllowedError') {
          if (!aborted) setState((s) => ({ ...s, permissionDenied: true }));
        }
      },
    );

    const offLevel = manager.onLevel((rms) => setState((s) => ({ ...s, level: rms })));
    const offGate = manager.onGateChange((open) => setState((s) => ({ ...s, gateOpen: open })));

    return () => {
      aborted = true;
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

  // Sync gateway selfMute with the user's intent (footer mute toggle /
  // settings.muted). Runs on connection-ready and whenever the user toggles
  // mute mid-call. Decoupled from per-transmission speaking state.
  useEffect(() => {
    if (!opts.enabled) return;
    void window.botcord.voice.setMute(opts.settings.muted);
  }, [opts.enabled, opts.settings.muted]);

  // PTT on/off chimes. Edge-detect on gateOpen, scoped to PTT mode so VAD
  // doesn't fire a beep on every utterance.
  const prevGate = useRef(false);
  useEffect(() => {
    console.log('[ptt] chime effect — mode:', opts.settings.mode, 'state.gateOpen:', state.gateOpen, 'prevGate:', prevGate.current);
    if (opts.settings.mode === 'ptt') {
      if (state.gateOpen && !prevGate.current && opts.settings.sounds.pttOn) playVoiceSound('pttOn');
      if (!state.gateOpen && prevGate.current && opts.settings.sounds.pttOff) playVoiceSound('pttOff');
    }
    prevGate.current = state.gateOpen;
  }, [state.gateOpen, opts.settings.mode, opts.settings.sounds.pttOn, opts.settings.sounds.pttOff]);

  // PTT key event subscription. We track the global IPC pulse and the local
  // keydown/keyup separately and OR-combine: local gives precise hold while
  // BotCord is focused (common case), global pulses 250ms per press for the
  // unfocused fallback. Local cleanup happens on blur so a key held when the
  // window loses focus doesn't get stuck open.
  const localHeldRef = useRef(false);
  const globalHeldRef = useRef(false);
  useEffect(() => {
    if (opts.settings.mode !== 'ptt') return;
    const sync = () => managerRef.current?.setPttHeld(localHeldRef.current || globalHeldRef.current);

    const accel = opts.settings.pttBinding?.accelerator ?? '';
    const matches = (e: KeyboardEvent) => !!accel && acceleratorMatches(accel, e);
    const down = (e: KeyboardEvent) => { if (matches(e)) { localHeldRef.current = true; sync(); } };
    const up = (e: KeyboardEvent) => { if (matches(e)) { localHeldRef.current = false; sync(); } };
    const blur = () => { localHeldRef.current = false; sync(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);

    // Always subscribe to onPttHeld — the global IPC pulse can fire from any
    // of the three main-process sources (uiohook, Electron globalShortcut,
    // XDG portal) regardless of what pttScope the IPC handler returned. The
    // portal in particular registers fire-and-forget, so its activations
    // arrive even when scope is reported as 'app'.
    let offGlobal: (() => void) | undefined;
    {
      offGlobal = window.botcord.voice.onPttHeld((held) => {
        console.log('[ptt] onPttHeld received:', held);
        globalHeldRef.current = held;
        sync();
      });
    }

    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      offGlobal?.();
      localHeldRef.current = false;
      globalHeldRef.current = false;
      managerRef.current?.setPttHeld(false);
    };
  }, [opts.settings.mode, opts.settings.pttBinding?.accelerator]);

  return state;
}

function acceleratorMatches(accel: string, e: KeyboardEvent): boolean {
  // "Control+Shift+Space" → require all listed modifiers + key.
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
  // Task 12 stores bindings with letters as bare 'A' (KeyA → A) and digits
  // as bare '1' (Digit1 → 1). Reconstruct both code forms here so app-scope
  // matching works without forcing the recorder to keep the prefix.
  if (e.code === key) return true;
  if (e.key === key) return true;
  if (/^[A-Z]$/.test(key) && e.code === `Key${key}`) return true;
  if (/^[0-9]$/.test(key) && e.code === `Digit${key}`) return true;
  return false;
}
