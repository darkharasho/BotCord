import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { ForumChannelDetail, ForumPostSummary } from '../../shared/domain';

// Loads a forum channel's posts and tags, then keeps the post list in sync
// with live ThreadCreate/ThreadUpdate/ThreadDelete events. Archived posts are
// fetched on demand (separate Discord API call) and merged in when shown.
export function useForum(guildId: string | null, forumId: string | null) {
  const [detail, setDetail] = useState<ForumChannelDetail | null>(null);
  const [archived, setArchived] = useState<ForumPostSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  const sortPosts = (list: ForumPostSummary[]): ForumPostSummary[] =>
    [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActivityAt - a.lastActivityAt);

  // Initial / on-change fetch. We pull active and archived in parallel so
  // forums where most posts have auto-archived still feel populated. The
  // archived call is not always cheap (one Discord API request), but for
  // the open forum it's a worthwhile up-front cost.
  useEffect(() => {
    if (!guildId || !forumId) {
      setDetail(null); setArchived(null); setError(null);
      return;
    }
    const id = ++reqRef.current;
    setLoading(true);
    setArchivedLoading(true);
    setArchived(null);

    api.guilds.getForum(guildId, forumId).then(res => {
      if (id !== reqRef.current) return;
      if (res.ok) { setDetail(res.data); setError(null); }
      else { setDetail(null); setError(res.error.message); }
      setLoading(false);
    });

    api.guilds.listArchivedForumPosts(guildId, forumId).then(res => {
      if (id !== reqRef.current) return;
      setArchived(res.ok ? sortPosts(res.data) : []);
      setArchivedLoading(false);
    });
  }, [guildId, forumId]);

  // Live updates — re-key by forumId so handlers always see the active one.
  useEffect(() => {
    if (!forumId) return;
    const unsubU = api.events.onForumPostUpdate(({ forumId: fid, post }) => {
      if (fid !== forumId) return;
      setDetail(prev => prev ? { ...prev, posts: sortPosts(mergePost(prev.posts, post)) } : prev);
      setArchived(prev => prev ? sortPosts(post.archived ? mergePost(prev, post) : prev.filter(p => p.id !== post.id)) : prev);
    });
    const unsubD = api.events.onForumPostDelete(({ forumId: fid, postId }) => {
      if (fid !== forumId) return;
      setDetail(prev => prev ? { ...prev, posts: prev.posts.filter(p => p.id !== postId) } : prev);
      setArchived(prev => prev ? prev.filter(p => p.id !== postId) : prev);
    });
    return () => { unsubU(); unsubD(); };
  }, [forumId]);

  return { detail, archived, loading, archivedLoading, error };
}

function mergePost(list: ForumPostSummary[], post: ForumPostSummary): ForumPostSummary[] {
  const i = list.findIndex(p => p.id === post.id);
  if (i === -1) return [...list, post];
  const next = list.slice();
  next[i] = post;
  return next;
}
