import type { ForumPostSummary, ForumTag } from '../../shared/domain';
import { IconMessageCircle2, IconPinned, IconLock, IconArchive } from '@tabler/icons-react';

type Props = {
  post: ForumPostSummary;
  tagsById: Map<string, ForumTag>;
  onClick: () => void;
};

// One card in the forum's post list. Mirrors Discord's compact layout:
// title row with pinned/locked glyphs, optional tag chips beneath, and a
// footer with author + activity timestamp + message count.
export function PostCard({ post, tagsById, onClick }: Props) {
  const tags = post.appliedTagIds
    .map(id => tagsById.get(id))
    .filter((t): t is ForumTag => Boolean(t));
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-bg-subtle border border-white/[0.04] rounded-lg px-4 py-3 hover:bg-hover/60 hover:border-white/[0.08] transition-colors duration-150 animate-fade-in-up
        ${post.archived ? 'opacity-70 hover:opacity-100' : ''}`}
    >
      <div className="flex items-start gap-2">
        {post.pinned && <IconPinned size={14} stroke={2} className="text-warn shrink-0 mt-1" />}
        {post.locked && <IconLock size={14} stroke={2} className="text-fg-dim shrink-0 mt-1" />}
        {post.archived && <IconArchive size={14} stroke={2} className="text-fg-dim shrink-0 mt-1" />}
        <span className="font-semibold text-fg text-[15px] leading-5 line-clamp-2 flex-1">{post.name}</span>
      </div>

      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map(t => <TagChip key={t.id} tag={t} />)}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 text-[12px] text-fg-dim">
        {post.ownerAvatarUrl
          ? <img src={post.ownerAvatarUrl} alt="" className="w-4 h-4 rounded-full shrink-0" />
          : <div className="w-4 h-4 rounded-full bg-bg-input shrink-0" />}
        <span
          className="truncate max-w-[160px]"
          style={post.ownerRoleColor ? { color: post.ownerRoleColor } : undefined}
        >
          {post.ownerDisplayName ?? 'unknown'}
        </span>
        <span className="text-fg-dim/70">·</span>
        <span className="shrink-0">{formatRelative(post.lastActivityAt)}</span>
        <div className="flex-1" />
        <span className="flex items-center gap-1 shrink-0">
          <IconMessageCircle2 size={13} stroke={2} />
          {post.messageCount}
        </span>
      </div>
    </button>
  );
}

function TagChip({ tag }: { tag: ForumTag }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-input text-fg-muted text-[11px] leading-4 border border-white/[0.04]">
      {tag.emojiUnicode && <span>{tag.emojiUnicode}</span>}
      {tag.emojiId && tag.emojiName && (
        <img
          src={`https://cdn.discordapp.com/emojis/${tag.emojiId}.png`}
          alt={tag.emojiName}
          className="w-3.5 h-3.5"
        />
      )}
      <span>{tag.name}</span>
    </span>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
