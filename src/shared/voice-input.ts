export type VoiceInputMode = 'ptt' | 'va';
export type PttScope = 'global' | 'app';

export type PttBinding = {
  // Electron accelerator string, e.g. "Control+Shift+Space" or "F13".
  accelerator: string;
};

export type VoiceInputSounds = {
  join: boolean;
  leave: boolean;
  pttOn: boolean;
  pttOff: boolean;
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
  sounds: VoiceInputSounds;
};

export const DEFAULT_VOICE_INPUT_SOUNDS: VoiceInputSounds = {
  join: true,
  leave: true,
  pttOn: true,
  pttOff: true,
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
  sounds: DEFAULT_VOICE_INPUT_SOUNDS,
};

// A "safe" global accelerator is one that won't lock the user out of normal
// typing if registered with Electron's globalShortcut. Any binding with at
// least one modifier (Ctrl/Shift/Alt/Meta) is safe; an F-key alone (F1–F24)
// is also safe since they aren't text-input keys. Everything else — bare
// letters, digits, Space, Enter, Esc, etc. — would consume every press of
// that key in every application on the system, which is unacceptable.
export function isSafeGlobalAccelerator(accel: string): boolean {
  if (typeof accel !== 'string' || accel.length === 0) return false;
  const parts = accel.split('+').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  const key = parts[parts.length - 1]!;
  const modifiers = parts.slice(0, -1);
  if (modifiers.length > 0) return true;
  if (/^F([1-9]|1\d|2[0-4])$/.test(key)) return true;
  return false;
}

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
