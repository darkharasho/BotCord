import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageSummary } from '../../shared/domain';

const PAGE = 50;

export type UseChannelMessages = {
  messages: MessageSummary[];
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  loadOlder: () => Promise<void>;
};

export function useChannelMessages(channelId: string | null): UseChannelMessages {
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelIdRef = useRef(channelId);
  channelIdRef.current = channelId;

  useEffect(() => {
    if (!channelId) { setMessages([]); setHasMore(false); return; }
    let active = true;
    setLoading(true);
    setError(null);
    setHasMore(true);
    window.botcord.messages.history(channelId, { limit: PAGE }).then(res => {
      if (!active || channelIdRef.current !== channelId) return;
      if (res.ok) {
        const sorted = [...res.data].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
        setMessages(sorted);
        setHasMore(res.data.length >= PAGE);
      } else {
        setError(res.error.message);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [channelId]);

  useEffect(() => {
    if (!channelId) return;
    const unsubC = window.botcord.events.onMessageCreate(({ channelId: cid, message }) => {
      if (cid !== channelIdRef.current) return;
      setMessages(prev => prev.some(m => m.id === message.id) ? prev : [...prev, message]);
    });
    const unsubU = window.botcord.events.onMessageUpdate(({ channelId: cid, message }) => {
      if (cid !== channelIdRef.current) return;
      setMessages(prev => prev.map(m => m.id === message.id ? message : m));
    });
    const unsubD = window.botcord.events.onMessageDelete(({ channelId: cid, messageId }) => {
      if (cid !== channelIdRef.current) return;
      setMessages(prev => prev.filter(m => m.id !== messageId));
    });
    return () => { unsubC(); unsubU(); unsubD(); };
  }, [channelId]);

  const loadOlder = useCallback(async () => {
    const cid = channelIdRef.current;
    if (!cid || !hasMore || loading) return;
    const oldest = messages[0];
    if (!oldest) return;
    setLoading(true);
    const res = await window.botcord.messages.history(cid, { limit: PAGE, before: oldest.id });
    if (cid !== channelIdRef.current) { setLoading(false); return; }
    if (res.ok) {
      const sorted = [...res.data].sort((a, b) => a.createdAt - b.createdAt);
      setMessages(prev => [...sorted, ...prev]);
      setHasMore(res.data.length >= PAGE);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
  }, [messages, hasMore, loading]);

  return { messages, loading, hasMore, error, loadOlder };
}
