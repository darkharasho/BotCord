import { useEffect, useState } from 'react';

// How long after the last speaker tick we keep showing a user as "speaking".
// The main-process mixer emits levels every 20 ms while audio is flowing and
// goes silent the moment the user stops, so a small TTL smooths the ring
// instead of flickering once per word boundary.
const SPEAKING_TTL_MS = 250;
const DECAY_TICK_MS = 100;

const lastTick = new Map<string, number>();
const localSpeaking = new Set<string>();
const listeners = new Set<(s: ReadonlySet<string>) => void>();

let subscribed = false;
let decayHandle: ReturnType<typeof setInterval> | null = null;

function compute(): Set<string> {
  const now = Date.now();
  const next = new Set<string>();
  for (const [id, ts] of lastTick) if (now - ts < SPEAKING_TTL_MS) next.add(id);
  for (const id of localSpeaking) next.add(id);
  return next;
}

function broadcast(): void {
  const next = compute();
  for (const l of listeners) l(next);
}

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  // The main mixer broadcasts a {userId: rms} record only when at least one
  // speaker is producing audio in the last tick. Each entry refreshes the
  // user's TTL; the decay interval clears stale entries so the ring drops.
  window.botcord.voice.onSpeakers((payload) => {
    const map = payload as Record<string, number>;
    const now = Date.now();
    for (const userId of Object.keys(map)) lastTick.set(userId, now);
    broadcast();
  });
  decayHandle = setInterval(broadcast, DECAY_TICK_MS);
  void decayHandle;
}

// Drive the bot's own ring from the renderer's local gate state — the bot
// can't hear itself through the receive pipeline, so its userId would never
// appear in the speakers map without this bridge.
export function setLocalSpeaking(userId: string | null | undefined, speaking: boolean): void {
  if (!userId) return;
  const had = localSpeaking.has(userId);
  if (speaking) localSpeaking.add(userId);
  else localSpeaking.delete(userId);
  if (had !== speaking) broadcast();
}

export function useVoiceSpeakers(): ReadonlySet<string> {
  const [speakers, setSpeakers] = useState<ReadonlySet<string>>(() => compute());
  useEffect(() => {
    ensureSubscribed();
    listeners.add(setSpeakers);
    return () => { listeners.delete(setSpeakers); };
  }, []);
  return speakers;
}
