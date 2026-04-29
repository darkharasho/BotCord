import { useMemo, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { api } from '../lib/api';
import { pushToast } from './Toaster';
import type { ForumPostSummary, ForumTag } from '../../shared/domain';

const MAX_TITLE = 100;
const MAX_BODY = 2000;
const MAX_TAGS = 5;

type Props = {
  forumId: string;
  forumName: string;
  availableTags: ForumTag[];
  requireTag: boolean;
  onClose: () => void;
  onCreated: (post: ForumPostSummary) => void;
};

export function CreatePostModal({ forumId, forumName, availableTags, requireTag, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tagIds, setTagIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const tagsValid = requireTag ? tagIds.size > 0 : true;
  const titleTrimmed = title.trim();
  const bodyTrimmed = body.trim();
  const valid =
    titleTrimmed.length > 0 &&
    titleTrimmed.length <= MAX_TITLE &&
    bodyTrimmed.length > 0 &&
    bodyTrimmed.length <= MAX_BODY &&
    tagsValid;

  const tagsById = useMemo(() => new Map(availableTags.map(t => [t.id, t])), [availableTags]);

  const toggleTag = (id: string) => {
    setTagIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_TAGS) next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    const res = await api.messages.createForumPost(forumId, {
      name: titleTrimmed,
      content: bodyTrimmed,
      appliedTagIds: Array.from(tagIds),
    });
    setBusy(false);
    if (!res.ok) {
      pushToast('danger', `Couldn't create post: ${res.error.message}`);
      return;
    }
    pushToast('ok', 'Post created');
    onCreated(res.data);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div
        className="bg-bg-subtle border border-border rounded-lg w-[36rem] max-w-[92vw] max-h-[90vh] overflow-y-auto shadow-2xl animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-fg truncate">New post in {forumName}</h2>
            {requireTag && (
              <p className="text-[11px] text-fg-dim mt-0.5">This forum requires at least one tag.</p>
            )}
          </div>
          <button className="text-fg-muted hover:text-fg shrink-0" onClick={onClose} title="Close">
            <IconX size={18} stroke={2} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <div>
            <label className="flex items-center justify-between text-[11px] uppercase font-semibold text-fg-dim mb-1">
              <span>Title</span>
              <span className={titleTrimmed.length > MAX_TITLE ? 'text-danger' : 'text-fg-dim/70'}>
                {titleTrimmed.length}/{MAX_TITLE}
              </span>
            </label>
            <input
              autoFocus
              maxLength={MAX_TITLE}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Post title…"
              className="w-full bg-bg-input border border-border rounded px-3 py-2 text-fg text-sm outline-none focus:border-accent"
            />
          </div>

          {availableTags.length > 0 && (
            <div>
              <label className="flex items-center justify-between text-[11px] uppercase font-semibold text-fg-dim mb-1">
                <span>Tags{requireTag ? ' *' : ''}</span>
                <span className="text-fg-dim/70">{tagIds.size}/{MAX_TAGS}</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {availableTags.map(tag => {
                  const active = tagIds.has(tag.id);
                  const disabled = !active && tagIds.size >= MAX_TAGS;
                  return (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag.id)}
                      disabled={disabled}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] leading-4 border transition-colors duration-150
                        ${active
                          ? 'bg-accent/15 border-accent/40 text-fg'
                          : 'bg-bg-input border-white/[0.04] text-fg-muted hover:bg-hover hover:text-fg'}
                        ${disabled ? 'opacity-40 cursor-not-allowed hover:bg-bg-input hover:text-fg-muted' : ''}`}
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
              </div>
              {tagIds.size > 0 && (
                <div className="mt-2 text-[11px] text-fg-dim">
                  Selected: {Array.from(tagIds).map(id => tagsById.get(id)?.name).filter(Boolean).join(', ')}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="flex items-center justify-between text-[11px] uppercase font-semibold text-fg-dim mb-1">
              <span>Body</span>
              <span className={bodyTrimmed.length > MAX_BODY ? 'text-danger' : 'text-fg-dim/70'}>
                {bodyTrimmed.length}/{MAX_BODY}
              </span>
            </label>
            <textarea
              maxLength={MAX_BODY}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the first message of your post…"
              rows={8}
              className="w-full bg-bg-input border border-border rounded px-3 py-2 text-fg text-sm outline-none focus:border-accent resize-y min-h-[140px]"
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2 bg-bg-sunken">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded text-fg hover:bg-hover text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!valid || busy}
            className="px-4 py-2 rounded bg-accent text-white text-sm hover:bg-accent-hover disabled:opacity-40"
          >
            {busy ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}
