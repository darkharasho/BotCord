import { describe, it, expect } from 'vitest';
import { DEFAULT_VOICE_INPUT_SETTINGS, createVadGate } from '../voice-input';

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
