import { useEffect, useState } from 'react';
import { IconMessageCircle2, IconLock, IconArchive, IconPinned } from '@tabler/icons-react';
import { api } from '../lib/api';
import type { ForumPostSummary, ForumTag } from '../../shared/domain';

type Props = {
  guildId: string;
  forumId: string;
  postId: string;
  // Title comes from the channel cache (always available); fall back here
  // even if the forum fetch hasn't completed yet, so the header doesn't
  // "pop in" after a delay.
  fallbackTitle: string;
};

// Header strip rendered at the top of the message feed when the current
// channel is a thread under a forum — the page-style intro Discord shows
// before the original post and replies.
export function ForumPostHeader({ guildId, forumId, postId, fallbackTitle }: Props) {
  const [post, setPost] = useState<ForumPostSummary | null>(null);
  const [tagsById, setTagsById] = useState<Map<string, ForumTag>>(new Map());

  useEffect(() => {
    let active = true;
    api.guilds.getForum(guildId, forumId).then(res => {
      if (!active || !res.ok) return;
      const found = res.data.posts.find(p => p.id === postId) ?? null;
      setPost(found);
      setTagsById(new Map(res.data.availableTags.map(t => [t.id, t])));
    });
    return () => { active = false; };
  }, [guildId, forumId, postId]);

  // Live updates — keep tags / pinned / archived state fresh while viewing.
  useEffect(() => {
    const unsub = api.events.onForumPostUpdate(({ forumId: fid, post: p }) => {
      if (fid === forumId && p.id === postId) setPost(p);
    });
    return () => unsub();
  }, [forumId, postId]);

  const title = post?.name ?? fallbackTitle;
  const tags = (post?.appliedTagIds ?? [])
    .map(id => tagsById.get(id))
    .filter((t): t is ForumTag => Boolean(t));

  return (
    <div className="px-4 pt-6 pb-4 border-b border-white/[0.04]">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-bg-subtle border border-white/[0.06] flex items-center justify-center text-fg-muted">
          <IconMessageCircle2 size={20} stroke={1.75} />
        </div>
      </div>
      <h1 className="text-[28px] leading-[1.15] font-bold text-fg break-words">{title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {post?.pinned && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] leading-4 bg-warn/15 border border-warn/30 text-warn">
            <IconPinned size={12} stroke={2} /> Pinned
          </span>
        )}
        {post?.locked && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] leading-4 bg-fg-dim/10 border border-fg-dim/20 text-fg-muted">
            <IconLock size={12} stroke={2} /> Locked
          </span>
        )}
        {post?.archived && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] leading-4 bg-fg-dim/10 border border-fg-dim/20 text-fg-muted">
            <IconArchive size={12} stroke={2} /> Archive
          </span>
        )}
        {tags.map(t => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-bg-input border border-white/[0.06] text-fg-muted text-[11px] leading-4"
          >
            {t.emojiUnicode && <span>{t.emojiUnicode}</span>}
            {t.emojiId && t.emojiName && (
              <img
                src={`https://cdn.discordapp.com/emojis/${t.emojiId}.png`}
                alt={t.emojiName}
                className="w-3.5 h-3.5"
              />
            )}
            {t.name}
          </span>
        ))}
      </div>
    </div>
  );
}
