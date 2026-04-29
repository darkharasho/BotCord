import { useEffect, useState } from 'react';
import { api } from './api';
import type { BotIdentity } from '../../shared/domain';

let cached: BotIdentity | null = null;
const subscribers = new Set<(id: BotIdentity | null) => void>();
let subscribed = false;

function ensureGlobalSubscription() {
  if (subscribed) return;
  subscribed = true;
  api.bot.getStatus().then(s => {
    if (s.kind === 'configured') {
      cached = s.identity;
      subscribers.forEach(cb => cb(cached));
    }
  });
  api.events.onBotStatus(s => {
    if (s.kind === 'configured') {
      cached = s.identity;
      subscribers.forEach(cb => cb(cached));
    }
  });
}

/**
 * Returns the bot's identity (id, username, avatar). Renderer-wide cached
 * after the first call so every message row can ask without firing IPCs.
 */
export function useBotIdentity(): BotIdentity | null {
  const [id, setId] = useState<BotIdentity | null>(cached);
  useEffect(() => {
    ensureGlobalSubscription();
    if (cached) setId(cached);
    const cb = (next: BotIdentity | null) => setId(next);
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  }, []);
  return id;
}
