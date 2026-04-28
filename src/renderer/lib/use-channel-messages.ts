import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageSummary } from '../../shared/domain';

const PAGE = 50;

type CacheEntry = { messages: MessageSummary[]; hasMore: boolean };
const cache = new Map<string, CacheEntry>();

const sortMessages = (list: MessageSummary[]): MessageSummary[] =>
  [...list].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

export type UseChannelMessages = {
  messages: MessageSummary[];
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  loadOlder: () => Promise<void>;
};

export function useChannelMessages(channelId: string | null): UseChannelMessages {
  const cached = channelId ? cache.get(channelId) : undefined;
  const [messages, setMessages] = useState<MessageSummary[]>(cached?.messages ?? []);
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? true);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const channelIdRef = useRef(channelId);
  channelIdRef.current = channelId;

  // Keep cache in sync whenever messages change for the active channel.
  const setMessagesAndCache = useCallback((updater: MessageSummary[] | ((prev: MessageSummary[]) => MessageSummary[]), nextHasMore?: boolean) => {
    setMessages(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (channelIdRef.current) {
        cache.set(channelIdRef.current, {
          messages: next,
          hasMore: nextHasMore ?? cache.get(channelIdRef.current)?.hasMore ?? true,
        });
      }
      return next;
    });
    if (nextHasMore !== undefined) setHasMore(nextHasMore);
  }, []);

  // Channel switch: hydrate from cache, then refresh in background.
  useEffect(() => {
    if (!channelId) {
      setMessages([]);
      setHasMore(false);
      setLoading(false);
      setError(null);
      return;
    }
    const entry = cache.get(channelId);
    if (entry) {
      setMessages(entry.messages);
      setHasMore(entry.hasMore);
      setLoading(false);
    } else {
      setMessages([]);
      setHasMore(true);
      setLoading(true);
    }
    setError(null);

    let active = true;
    window.botcord.messages.history(channelId, { limit: PAGE }).then(res => {
      if (!active || channelIdRef.current !== channelId) return;
      if (res.ok) {
        const sorted = sortMessages(res.data);
        const nextHasMore = res.data.length >= PAGE;
        cache.set(channelId, { messages: sorted, hasMore: nextHasMore });
        setMessages(sorted);
        setHasMore(nextHasMore);
      } else {
        setError(res.error.message);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [channelId]);

  // Live event subscriptions.
  useEffect(() => {
    if (!channelId) return;
    const unsubC = window.botcord.events.onMessageCreate(({ channelId: cid, message }) => {
      if (cid !== channelIdRef.current) return;
      setMessagesAndCache(prev => prev.some(m => m.id === message.id) ? prev : [...prev, message]);
    });
    const unsubU = window.botcord.events.onMessageUpdate(({ channelId: cid, message }) => {
      if (cid !== channelIdRef.current) return;
      setMessagesAndCache(prev => prev.map(m => m.id === message.id ? message : m));
    });
    const unsubD = window.botcord.events.onMessageDelete(({ channelId: cid, messageId }) => {
      if (cid !== channelIdRef.current) return;
      setMessagesAndCache(prev => prev.filter(m => m.id !== messageId));
    });
    return () => { unsubC(); unsubU(); unsubD(); };
  }, [channelId, setMessagesAndCache]);

  const loadOlder = useCallback(async () => {
    const cid = channelIdRef.current;
    if (!cid || !hasMore || loading) return;
    const oldest = messages[0];
    if (!oldest) return;
    setLoading(true);
    const res = await window.botcord.messages.history(cid, { limit: PAGE, before: oldest.id });
    if (cid !== channelIdRef.current) { setLoading(false); return; }
    if (res.ok) {
      const sorted = sortMessages(res.data);
      const nextHasMore = res.data.length >= PAGE;
      setMessagesAndCache(prev => [...sorted, ...prev], nextHasMore);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
  }, [messages, hasMore, loading, setMessagesAndCache]);

  return { messages, loading, hasMore, error, loadOlder };
}
