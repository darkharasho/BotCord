import { useEffect, useState } from 'react';
import { api } from './api';

// Per-channel set of trigger-message IDs the bot is currently thinking
// about. Driven by event.autonomyThinkingStart / End broadcasts from main.
const inFlight = new Map<string, Set<string>>();
const listeners = new Set<() => void>();

const notify = () => { for (const l of listeners) l(); };

let wired = false;
const ensureWired = () => {
  if (wired) return;
  wired = true;
  api.events.onAutonomyThinkingStart(({ channelId, triggerMessageId }) => {
    let set = inFlight.get(channelId);
    if (!set) { set = new Set(); inFlight.set(channelId, set); }
    set.add(triggerMessageId);
    notify();
  });
  api.events.onAutonomyThinkingEnd(({ channelId, triggerMessageId }) => {
    const set = inFlight.get(channelId);
    if (!set) return;
    set.delete(triggerMessageId);
    if (set.size === 0) inFlight.delete(channelId);
    notify();
  });
};

export function useAutonomyThinkingForChannel(channelId: string | null): Set<string> {
  const [, tick] = useState(0);
  useEffect(() => {
    ensureWired();
    const l = () => tick(t => t + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  if (!channelId) return EMPTY;
  return inFlight.get(channelId) ?? EMPTY;
}

const EMPTY: Set<string> = new Set();
