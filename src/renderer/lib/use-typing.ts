import { useEffect, useState } from 'react';
import { api } from './api';
import { useBotIdentity } from './use-bot-identity';

// Discord's typing event has no "stopped" counterpart — clients show the
// indicator for ~10s after the last typing start. We expire entries on a
// 10-second timer, refreshed each time we receive another start from the
// same user.
const EXPIRY_MS = 10_000;

type TypingEntry = { displayName: string; startedAt: number };

export function useTypingIndicators(channelId: string | null): string[] {
  const bot = useBotIdentity();
  const [typers, setTypers] = useState<Map<string, TypingEntry>>(new Map());

  useEffect(() => {
    setTypers(new Map());
  }, [channelId]);

  useEffect(() => {
    if (!channelId) return;
    const unsub = api.events.onTypingStart(({ channelId: cid, userId, displayName, startedAt }) => {
      if (cid !== channelId) return;
      if (bot && userId === bot.id) return; // hide our own bot's typing
      setTypers(prev => {
        const next = new Map(prev);
        next.set(userId, { displayName, startedAt });
        return next;
      });
    });
    return () => unsub();
  }, [channelId, bot]);

  // Periodically prune expired entries.
  useEffect(() => {
    const tick = window.setInterval(() => {
      setTypers(prev => {
        const cutoff = Date.now() - EXPIRY_MS;
        let changed = false;
        const next = new Map<string, TypingEntry>();
        for (const [id, entry] of prev) {
          if (entry.startedAt > cutoff) next.set(id, entry);
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(tick);
  }, []);

  return Array.from(typers.values()).map(t => t.displayName);
}
