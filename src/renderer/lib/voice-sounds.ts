// Synthesized notification beeps for voice events. Played locally to the
// BotCord user (never transmitted into the channel). We synthesize rather
// than ship audio assets to keep the bundle small and avoid licensing.
//
// Tones: short sine bursts with a tiny attack/release envelope so they don't
// click. Two-tone pairs for join/leave; single tones for PTT on/off.

export type VoiceSoundKind = 'join' | 'leave' | 'pttOn' | 'pttOff';

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx || ctx.state === 'closed') ctx = new AudioContext();
  // Browsers suspend the context until a user gesture; voice events follow
  // a click or a key press so resume() will succeed.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function beep(freq: number, startOffset: number, durationMs: number, gain = 0.18): void {
  const ac = getCtx();
  const start = ac.currentTime + startOffset;
  const end = start + durationMs / 1000;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.01);
  g.gain.linearRampToValueAtTime(gain, end - 0.03);
  g.gain.linearRampToValueAtTime(0, end);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(end + 0.02);
  osc.onended = () => { osc.disconnect(); g.disconnect(); };
}

export function playVoiceSound(kind: VoiceSoundKind): void {
  switch (kind) {
    case 'join':
      // Low → high cheerful pair.
      beep(523.25, 0, 110);     // C5
      beep(783.99, 0.10, 140);  // G5
      return;
    case 'leave':
      // High → low descending pair.
      beep(783.99, 0, 110);     // G5
      beep(523.25, 0.10, 160);  // C5
      return;
    case 'pttOn':
      // Quick rising chirp.
      beep(880.0, 0, 60, 0.14);  // A5
      return;
    case 'pttOff':
      // Quick falling chirp.
      beep(587.33, 0, 70, 0.14); // D5
      return;
  }
}
