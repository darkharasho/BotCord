import { useEffect, useRef, useState } from 'react';
import { api } from './api';

export type Unreads = {
  channelIds: Set<string>;
  guildIds: Set<string>;
};

/**
 * Tracks per-channel unread state across the whole shell.
 *
 * - Subscribes to messageCreate globally so any channel can become unread
 *   while the user is reading another (in any guild).
 * - The currently-viewed channel is always considered read; switching to a
 *   channel marks it read, and new messages arriving in it stay read.
 * - Rolls up to a per-guild unread set so the server rail can indicate
 *   guilds with unread channels.
 * - lastSeen timestamps are persisted to prefs so unreads survive app restart.
 */
export function useUnreads(activeChannelId: string | null): Unreads {
  const [, force] = useState(0);
  const lastSeen = useRef<Map<string, number>>(new Map());
  const latest = useRef<Map<string, number>>(new Map());
  const channelGuild = useRef<Map<string, string>>(new Map());
  const activeRef = useRef(activeChannelId);
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  activeRef.current = activeChannelId;

  // Persist lastSeen to prefs (debounced to avoid hammering SQLite)
  const persistLastSeen = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const obj: Record<string, number> = {};
      for (const [k, v] of lastSeen.current) obj[k] = v;
      api.prefs.set('channelLastSeen', obj);
    }, 2000);
  };

  // Load persisted lastSeen on mount
  useEffect(() => {
    api.prefs.get('channelLastSeen').then(res => {
      if (res.ok && res.data) {
        for (const [k, v] of Object.entries(res.data)) {
          lastSeen.current.set(k, v);
        }
      }
      loaded.current = true;
      force(n => n + 1);
    });
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!activeChannelId) return;
    const t = latest.current.get(activeChannelId) ?? Date.now();
    lastSeen.current.set(activeChannelId, t);
    if (loaded.current) persistLastSeen();
    force(n => n + 1);
  }, [activeChannelId]);

  useEffect(() => {
    return api.events.onMessageCreate(({ channelId, message }) => {
      latest.current.set(channelId, message.createdAt);
      if (message.guildId) channelGuild.current.set(channelId, message.guildId);
      if (channelId === activeRef.current) {
        lastSeen.current.set(channelId, message.createdAt);
        if (loaded.current) persistLastSeen();
      }
      force(n => n + 1);
    });
  }, []);

  const channelIds = new Set<string>();
  const guildIds = new Set<string>();
  for (const [cid, latestTs] of latest.current) {
    const seenTs = lastSeen.current.get(cid) ?? 0;
    if (latestTs > seenTs) {
      channelIds.add(cid);
      const gid = channelGuild.current.get(cid);
      if (gid) guildIds.add(gid);
    }
  }
  return { channelIds, guildIds };
}
