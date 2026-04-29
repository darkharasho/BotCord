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
 * - State is in-memory only for now (resets on app restart). Persistence
 *   to prefs is a follow-up.
 */
export function useUnreads(activeChannelId: string | null): Unreads {
  const [, force] = useState(0);
  const lastSeen = useRef<Map<string, number>>(new Map());
  const latest = useRef<Map<string, number>>(new Map());
  const channelGuild = useRef<Map<string, string>>(new Map());
  const activeRef = useRef(activeChannelId);
  activeRef.current = activeChannelId;

  useEffect(() => {
    if (!activeChannelId) return;
    const t = latest.current.get(activeChannelId) ?? Date.now();
    lastSeen.current.set(activeChannelId, t);
    force(n => n + 1);
  }, [activeChannelId]);

  useEffect(() => {
    return api.events.onMessageCreate(({ channelId, message }) => {
      latest.current.set(channelId, message.createdAt);
      if (message.guildId) channelGuild.current.set(channelId, message.guildId);
      if (channelId === activeRef.current) {
        lastSeen.current.set(channelId, message.createdAt);
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
