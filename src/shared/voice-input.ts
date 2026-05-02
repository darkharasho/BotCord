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
