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
