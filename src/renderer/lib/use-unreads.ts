import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useBotIdentity } from './use-bot-identity';

export type Unreads = {
  channelIds: Set<string>;
  guildIds: Set<string>;
  // Channels/guilds with at least one *mention* (bot @-mention or
  // @everyone/@here) since lastSeen — rendered in red.
  mentionChannelIds: Set<string>;
  mentionGuildIds: Set<string>;
  mentionGuildCounts: Map<string, number>;
  mentionChannelCounts: Map<string, number>;
  // Channels the user has muted via the right-click menu. Muted channels
  // are excluded from the regular unread sets above (they still receive
  // mentions, matching Discord's behavior).
  mutedChannelIds: Set<string>;
  toggleMuted: (channelId: string) => void;
  markGuildRead: (guildId: string) => void;
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
  const muted = useRef<Set<string>>(new Set());
  const lastSeen = useRef<Map<string, number>>(new Map());
  const latest = useRef<Map<string, number>>(new Map());
  // Per-channel map of mention message id -> timestamp. Tracks every
  // unread message that mentioned the bot or used @everyone/@here so we
  // can render an accurate count badge. Entries are pruned when the
  // channel is read or when the source message is deleted in Discord
  // (otherwise moderating away an @-ping would leave the badge stuck).
  const mentionMsgs = useRef<Map<string, Map<string, number>>>(new Map());
  const channelGuild = useRef<Map<string, string>>(new Map());
  const activeRef = useRef(activeChannelId);
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  activeRef.current = activeChannelId;
  const bot = useBotIdentity();
  const botIdRef = useRef<string | null>(null);
  botIdRef.current = bot?.id ?? null;

  // Persist lastSeen to prefs (debounced to avoid hammering SQLite)
  const persistLastSeen = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const obj: Record<string, number> = {};
      for (const [k, v] of lastSeen.current) obj[k] = v;
      api.prefs.set('channelLastSeen', obj);
    }, 2000);
  };

  // Load persisted lastSeen + muted set on mount
  useEffect(() => {
    Promise.all([
      api.prefs.get('channelLastSeen'),
      api.prefs.get('mutedChannelIds'),
    ]).then(([seenRes, mutedRes]) => {
      if (seenRes.ok && seenRes.data) {
        for (const [k, v] of Object.entries(seenRes.data)) {
          lastSeen.current.set(k, v);
        }
      }
      if (mutedRes.ok && Array.isArray(mutedRes.data)) {
        for (const id of mutedRes.data) muted.current.add(id);
      }
      loaded.current = true;
      force(n => n + 1);
    });
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const toggleMuted = (channelId: string) => {
    if (muted.current.has(channelId)) muted.current.delete(channelId);
    else muted.current.add(channelId);
    api.prefs.set('mutedChannelIds', Array.from(muted.current));
    force(n => n + 1);
  };

  useEffect(() => {
    if (!activeChannelId) return;
    const t = latest.current.get(activeChannelId) ?? Date.now();
    lastSeen.current.set(activeChannelId, t);
    if (loaded.current) persistLastSeen();
    force(n => n + 1);
  }, [activeChannelId]);

  // Seed `latest` from each channel's `lastMessageId` so unreads survive
  // restart: even before any live messageCreate fires, we know the most
  // recent message timestamp per channel from the snowflake.
  useEffect(() => {
    let cancelled = false;
    const seedFromChannels = async () => {
      const guildsRes = await api.guilds.list();
      if (!guildsRes.ok || cancelled) return;
      await Promise.all(guildsRes.data.map(async g => {
        const channelsRes = await api.guilds.listChannels(g.id);
        if (!channelsRes.ok || cancelled) return;
        for (const c of channelsRes.data) {
          channelGuild.current.set(c.id, g.id);
          if (c.lastMessageId) {
            const ts = snowflakeTimestamp(c.lastMessageId);
            const existing = latest.current.get(c.id) ?? 0;
            if (ts > existing) latest.current.set(c.id, ts);
          }
        }
      }));
      if (!cancelled) force(n => n + 1);
    };
    seedFromChannels();
    const unsub = api.events.onGatewayState(s => { if (s.status === 'ready') seedFromChannels(); });
    return () => { cancelled = true; unsub(); };
  }, []);

  // Clear a tracked mention when its source message is deleted in Discord —
  // otherwise moderating away the offending @-ping leaves the red dot stuck
  // forever, with nothing the user can open to clear it.
  useEffect(() => {
    return api.events.onMessageDelete(({ channelId, messageId }) => {
      const channel = mentionMsgs.current.get(channelId);
      if (channel?.delete(messageId)) {
        if (channel.size === 0) mentionMsgs.current.delete(channelId);
        force(n => n + 1);
      }
    });
  }, []);

  const markGuildRead = (guildId: string) => {
    const now = Date.now();
    let changed = false;
    for (const [cid, gid] of channelGuild.current) {
      if (gid !== guildId) continue;
      const mentions = mentionMsgs.current.get(cid);
      let maxMention = 0;
      if (mentions) for (const ts of mentions.values()) if (ts > maxMention) maxMention = ts;
      const ts = Math.max(latest.current.get(cid) ?? 0, maxMention, now);
      lastSeen.current.set(cid, ts);
      mentionMsgs.current.delete(cid);
      changed = true;
    }
    if (changed) {
      if (loaded.current) persistLastSeen();
      force(n => n + 1);
    }
  };

  useEffect(() => {
    return api.events.onMessageCreate(({ channelId, message }) => {
      latest.current.set(channelId, message.createdAt);
      if (message.guildId) channelGuild.current.set(channelId, message.guildId);
      const botId = botIdRef.current;
      const mentionsBot = botId
        ? message.mentions.some(m => m.type === 'user' && m.id === botId)
        : false;
      if (message.mentionsEveryone || mentionsBot) {
        let channel = mentionMsgs.current.get(channelId);
        if (!channel) { channel = new Map(); mentionMsgs.current.set(channelId, channel); }
        channel.set(message.id, message.createdAt);
      }
      if (channelId === activeRef.current) {
        lastSeen.current.set(channelId, message.createdAt);
        if (loaded.current) persistLastSeen();
      }
      force(n => n + 1);
    });
  }, []);

  const channelIds = new Set<string>();
  const guildIds = new Set<string>();
  const mentionChannelIds = new Set<string>();
  const mentionGuildIds = new Set<string>();
  const mentionChannelCounts = new Map<string, number>();
  const mentionGuildCounts = new Map<string, number>();
  for (const [cid, latestTs] of latest.current) {
    const seenTs = lastSeen.current.get(cid) ?? 0;
    if (latestTs > seenTs) {
      const gid = channelGuild.current.get(cid);
      const isMuted = muted.current.has(cid);
      // Muted channels suppress all unread state — including mentions —
      // since BotCord has no UI to clear a mention without opening the
      // channel, and the user explicitly opted out of notifications.
      if (!isMuted) {
        channelIds.add(cid);
        if (gid) guildIds.add(gid);
        const mentions = mentionMsgs.current.get(cid);
        let count = 0;
        if (mentions) for (const ts of mentions.values()) if (ts > seenTs) count++;
        if (count > 0) {
          mentionChannelIds.add(cid);
          mentionChannelCounts.set(cid, count);
          if (gid) {
            mentionGuildIds.add(gid);
            mentionGuildCounts.set(gid, (mentionGuildCounts.get(gid) ?? 0) + count);
          }
        }
      }
    }
  }
  return {
    channelIds,
    guildIds,
    mentionChannelIds,
    mentionGuildIds,
    mentionChannelCounts,
    mentionGuildCounts,
    mutedChannelIds: muted.current,
    toggleMuted,
    markGuildRead,
  };
}

const DISCORD_EPOCH = 1420070400000;
function snowflakeTimestamp(id: string): number {
  // Snowflake high bits encode (ms since Discord epoch). Use BigInt because
  // 64-bit snowflakes overflow JS Number precision past 53 bits.
  try {
    return Number((BigInt(id) >> 22n)) + DISCORD_EPOCH;
  } catch {
    return 0;
  }
}
