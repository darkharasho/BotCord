import { useEffect, useRef, useState } from 'react';
import { MicCaptureManager } from './mic-capture';
import {
  type VoiceInputSettings,
} from '../../shared/voice-input';

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

  // PTT key event subscription.
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
  return e.code === key || e.key === key;
}
