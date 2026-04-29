import { useEffect, useRef, useState } from 'react';
import { api } from './api';

/**
 * Tracks per-channel unread state across the whole shell.
 *
 * - Subscribes to messageCreate globally so any channel can become unread
 *   while the user is reading another.
 * - The currently-viewed channel is always considered read; switching to a
 *   channel marks it read, and new messages arriving in it stay read.
 * - State is in-memory only for now (resets on app restart). Persistence
 *   to prefs is a follow-up.
 */
export function useUnreads(activeChannelId: string | null): Set<string> {
  const [, force] = useState(0);
  const lastSeen = useRef<Map<string, number>>(new Map());
  const latest = useRef<Map<string, number>>(new Map());
  const activeRef = useRef(activeChannelId);
  activeRef.current = activeChannelId;

  // Mark the active channel read whenever it changes, and clear any stale unread.
  useEffect(() => {
    if (!activeChannelId) return;
    const t = latest.current.get(activeChannelId) ?? Date.now();
    lastSeen.current.set(activeChannelId, t);
    force(n => n + 1);
  }, [activeChannelId]);

  useEffect(() => {
    return api.events.onMessageCreate(({ channelId, message }) => {
      latest.current.set(channelId, message.createdAt);
      // Active channel auto-stays-read.
      if (channelId === activeRef.current) {
        lastSeen.current.set(channelId, message.createdAt);
      }
      force(n => n + 1);
    });
  }, []);

  const unread = new Set<string>();
  for (const [cid, latestTs] of latest.current) {
    const seenTs = lastSeen.current.get(cid) ?? 0;
    if (latestTs > seenTs) unread.add(cid);
  }
  return unread;
}
