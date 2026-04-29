import { useMemo, useState } from 'react';
import { IconMessages, IconArchive, IconArchiveOff, IconSearch, IconX, IconPlus } from '@tabler/icons-react';
import { useForum } from '../../lib/use-forum';
import { PostCard } from '../../components/PostCard';
import { CreatePostModal } from '../../components/CreatePostModal';
import type { ForumPostSummary, ForumTag } from '../../../shared/domain';

type Props = {
  guildId: string | null;
  forumId: string;
  forumName: string;
  onSelectPost: (postId: string, postName: string) => void;
};

export function ForumView({ guildId, forumId, forumName, onSelectPost }: Props) {
  const { detail, archived, loading, archivedLoading, error } = useForum(guildId, forumId);
  const [showArchived, setShowArchived] = useState(true);
  const [activeTagIds, setActiveTagIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const tagsById = useMemo(() => {
    const map = new Map<string, ForumTag>();
    for (const t of detail?.availableTags ?? []) map.set(t.id, t);
    return map;
  }, [detail?.availableTags]);

  const visiblePosts = useMemo(() => {
    const base: ForumPostSummary[] = [
      ...(detail?.posts ?? []),
      ...(showArchived ? (archived ?? []) : []),
    ];
    // Dedupe in case an event marked a cached post archived: prefer the
    // archived version to reflect latest state.
    const seen = new Map<string, ForumPostSummary>();
    for (const p of base) seen.set(p.id, p);
    let list = Array.from(seen.values());
    if (activeTagIds.size > 0) {
      list = list.filter(p => p.appliedTagIds.some(id => activeTagIds.has(id)));
    }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q));
    return list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActivityAt - a.lastActivityAt);
  }, [detail, archived, showArchived, activeTagIds, search]);

  const toggleTag = (id: string) => {
    setActiveTagIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleArchived = () => setShowArchived(s => !s);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg border-t border-l border-white/[0.04] overflow-hidden">
      <div className="h-12 flex items-center px-4 shrink-0 border-b border-white/[0.04] gap-2">
        <IconMessages size={22} stroke={2} className="text-fg-dim shrink-0" />
        <span className="font-semibold text-fg text-base truncate">{forumName}</span>
        <div className="flex-1" />
        {searchOpen ? (
          <div className="flex items-center bg-bg-input rounded h-7 px-2 gap-1.5 w-56">
            <IconSearch size={14} stroke={2} className="text-fg-dim shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); setSearchOpen(false); } }}
              placeholder="Search posts…"
              className="flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-dim min-w-0"
            />
            <button
              onClick={() => { setSearch(''); setSearchOpen(false); }}
              className="text-fg-dim hover:text-fg shrink-0"
              title="Close search"
            >
              <IconX size={14} stroke={2} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSearchOpen(true)}
            className="text-fg-dim hover:text-fg p-1 rounded hover:bg-hover"
            title="Search posts"
          >
            <IconSearch size={18} stroke={1.75} />
          </button>
        )}
        <button
          onClick={toggleArchived}
          className={`p-1 rounded hover:bg-hover transition-colors ${showArchived ? 'text-fg-dim hover:text-fg' : 'text-fg'}`}
          title={showArchived ? 'Hide archived posts' : 'Show archived posts'}
        >
          {showArchived ? <IconArchive size={18} stroke={1.75} /> : <IconArchiveOff size={18} stroke={1.75} />}
        </button>
        <button
          onClick={() => setCreateOpen(true)}
          disabled={!detail}
          className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded bg-accent text-white text-[12px] font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Create a new post"
        >
          <IconPlus size={14} stroke={2.25} />
          New post
        </button>
      </div>

      {(detail?.availableTags.length ?? 0) > 0 && (
        <div className="px-4 py-2 border-b border-white/[0.04] flex flex-wrap gap-1.5">
          {detail!.availableTags.map(tag => {
            const active = activeTagIds.has(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] leading-4 border transition-colors duration-150
                  ${active
                    ? 'bg-accent/15 border-accent/40 text-fg'
                    : 'bg-bg-input border-white/[0.04] text-fg-muted hover:bg-hover hover:text-fg'}`}
              >
                {tag.emojiUnicode && <span>{tag.emojiUnicode}</span>}
                {tag.emojiId && tag.emojiName && (
                  <img
                    src={`https://cdn.discordapp.com/emojis/${tag.emojiId}.png`}
                    alt={tag.emojiName}
                    className="w-3.5 h-3.5"
                  />
                )}
                {tag.name}
              </button>
            );
          })}
          {activeTagIds.size > 0 && (
            <button
              onClick={() => setActiveTagIds(new Set())}
              className="text-[11px] text-fg-dim hover:text-fg px-2 py-1"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        {error && <div className="text-danger text-sm">{error}</div>}
        {loading && !detail && <div className="text-fg-muted text-sm">Loading posts…</div>}
        {!loading && visiblePosts.length === 0 && (
          <div className="text-fg-muted text-sm py-8 text-center">
            {search || activeTagIds.size > 0 ? 'No posts match your filters.' : 'No posts yet.'}
          </div>
        )}
        <div key={`${forumId}-${showArchived}`} className="grid grid-cols-1 lg:grid-cols-2 gap-3 animate-fade-in">
          {visiblePosts.map(p => (
            <PostCard
              key={p.id}
              post={p}
              tagsById={tagsById}
              onClick={() => onSelectPost(p.id, p.name)}
            />
          ))}
        </div>
        {showArchived && archivedLoading && (
          <div className="text-fg-dim text-xs text-center mt-4">Loading archived…</div>
        )}
      </div>

      {createOpen && detail && (
        <CreatePostModal
          forumId={forumId}
          forumName={forumName}
          availableTags={detail.availableTags}
          requireTag={detail.requireTag}
          onClose={() => setCreateOpen(false)}
          onCreated={(post) => {
            setCreateOpen(false);
            // Jump straight into the new post — the live ThreadCreate event
            // will populate the list, so we don't need to manually refetch.
            onSelectPost(post.id, post.name);
          }}
        />
      )}
    </div>
  );
}
