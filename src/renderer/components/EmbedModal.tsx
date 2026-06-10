// src/renderer/components/EmbedModal.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { pushToast } from './Toaster';
import { EmbedCard } from './EmbedCard';
import { CheckBox } from './CheckBox';
import { EmbedImageField } from './EmbedImageField';
import { payloadToSummary, summaryToPayload } from '../lib/embed-adapters';
import type { EmbedPayload, DraftRow, SendAttachment, MessageAttachment, MessageEmbedSummary } from '../../shared/domain';
import { IconX, IconPlus, IconTrash } from '@tabler/icons-react';

// Discord embed limits.
const LIMITS = { title: 256, description: 4096, fieldName: 256, fieldValue: 1024, footer: 2048, author: 256, fields: 25, total: 6000 };
const DEFAULT_COLOR = '#007f68'; // accent

type FieldRow = { name: string; value: string; inline: boolean };

type ImageSlot = 'image' | 'thumbnail' | 'authorIcon' | 'footerIcon';
type SlotUpload = {
  name: string;            // attachment filename → field url becomes attachment://<name>
  previewUrl: string;      // object URL (new file) or CDN url (existing attachment)
  file: File | null;       // a newly picked local file (bytes to upload), else null
  existingAttachmentId: string | null; // an existing message attachment to keep, else null
  objectUrl: string | null; // object URL we created and must revoke, else null
};
const SLOT_BASENAME: Record<ImageSlot, string> = { image: 'image', thumbnail: 'thumbnail', authorIcon: 'author-icon', footerIcon: 'footer-icon' };
const IMAGE_SLOTS: ImageSlot[] = ['image', 'thumbnail', 'authorIcon', 'footerIcon'];
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

type FormState = {
  content: string;
  authorName: string; authorUrl: string; authorIcon: string;
  useColor: boolean; color: string;
  title: string; url: string;
  description: string;
  fields: FieldRow[];
  thumbnailUrl: string; imageUrl: string;
  footerText: string; footerIcon: string;
  useTimestamp: boolean;
  imageMode: Record<ImageSlot, 'url' | 'file'>;
  uploads: Record<ImageSlot, SlotUpload | null>;
};

const EMPTY: FormState = {
  content: '', authorName: '', authorUrl: '', authorIcon: '',
  useColor: true, color: DEFAULT_COLOR, title: '', url: '', description: '',
  fields: [], thumbnailUrl: '', imageUrl: '', footerText: '', footerIcon: '', useTimestamp: false,
  imageMode: { image: 'url', thumbnail: 'url', authorIcon: 'url', footerIcon: 'url' },
  uploads: { image: null, thumbnail: null, authorIcon: null, footerIcon: null },
};

// Build an EmbedPayload from the form, omitting empty values.
function buildPayload(s: FormState): EmbedPayload {
  const p: EmbedPayload = {};
  const slotUrl = (slot: ImageSlot, urlStr: string): string => {
    if (s.imageMode[slot] === 'file') return s.uploads[slot] ? `attachment://${s.uploads[slot]!.name}` : '';
    return urlStr.trim();
  };
  if (s.title.trim()) p.title = s.title.trim();
  if (s.description.trim()) p.description = s.description.trim();
  if (s.url.trim()) p.url = s.url.trim();
  if (s.useColor) p.color = parseInt(s.color.slice(1), 16);
  if (s.useTimestamp) p.timestamp = new Date().toISOString();
  if (s.footerText.trim()) {
    const fIcon = slotUrl('footerIcon', s.footerIcon);
    p.footer = fIcon ? { text: s.footerText.trim(), iconUrl: fIcon } : { text: s.footerText.trim() };
  }
  if (s.authorName.trim()) {
    const a: { name: string; url?: string; iconUrl?: string } = { name: s.authorName.trim() };
    if (s.authorUrl.trim()) a.url = s.authorUrl.trim();
    const aIcon = slotUrl('authorIcon', s.authorIcon);
    if (aIcon) a.iconUrl = aIcon;
    p.author = a;
  }
  const thumb = slotUrl('thumbnail', s.thumbnailUrl);
  if (thumb) p.thumbnail = { url: thumb };
  const img = slotUrl('image', s.imageUrl);
  if (img) p.image = { url: img };
  const fields = s.fields.filter(f => f.name.trim() && f.value.trim()).map(f => ({ name: f.name.trim(), value: f.value.trim(), inline: f.inline }));
  if (fields.length) p.fields = fields;
  return p;
}

// The live preview can't render an `attachment://…` reference (the browser has
// no such file yet), so swap those image fields for the slot's previewUrl — a
// local object URL for a freshly picked file, or the CDN url for an existing
// attachment. The real send payload keeps the `attachment://` urls untouched.
export function toPreviewPayload(
  payload: EmbedPayload,
  imageMode: Record<ImageSlot, 'url' | 'file'>,
  uploads: Record<ImageSlot, SlotUpload | null>,
): EmbedPayload {
  const previewUrl = (slot: ImageSlot): string | null =>
    imageMode[slot] === 'file' && uploads[slot] ? uploads[slot]!.previewUrl : null;
  const p: EmbedPayload = { ...payload };
  const img = previewUrl('image');
  if (img && p.image) p.image = { url: img };
  const thumb = previewUrl('thumbnail');
  if (thumb && p.thumbnail) p.thumbnail = { url: thumb };
  const aIcon = previewUrl('authorIcon');
  if (aIcon && p.author) p.author = { ...p.author, iconUrl: aIcon };
  const fIcon = previewUrl('footerIcon');
  if (fIcon && p.footer) p.footer = { ...p.footer, iconUrl: fIcon };
  return p;
}

// True when the embed carries at least one visible element.
function isNonEmpty(p: EmbedPayload): boolean {
  return !!(p.title || p.description || p.author || p.footer || p.image || p.thumbnail || (p.fields && p.fields.length));
}

function totalChars(p: EmbedPayload): number {
  return (p.title?.length ?? 0) + (p.description?.length ?? 0) + (p.author?.name.length ?? 0) +
    (p.footer?.text.length ?? 0) + (p.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
}

const inputBase =
  'w-full bg-bg-input border border-white/[0.06] rounded-md px-3 py-2 text-[14px] text-fg ' +
  'placeholder:text-fg-dim outline-none transition-colors duration-150 focus:border-accent';
const labelCls = 'block text-[12px] font-semibold text-fg-muted mb-1.5 uppercase tracking-wide';

export function EmbedModal({
  channelId, guildId, channelName, onClose, edit, initial, initialMessage,
}: {
  channelId: string;
  guildId: string | null;
  channelName: string;
  onClose: () => void;
  // When present, the modal edits an existing message instead of sending a new one.
  edit?: { messageId: string };
  initial?: FormState;
  initialMessage?: { content: string; embed: MessageEmbedSummary; attachments: MessageAttachment[] };
}) {
  const [s, setS] = useState<FormState>(
    initial ?? (initialMessage ? formFromMessage(initialMessage.content, initialMessage.embed, initialMessage.attachments) : EMPTY),
  );
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  useEffect(() => {
    let alive = true;
    api.drafts.list().then(res => { if (alive && res.ok) setDrafts(res.data.filter(d => d.embed)); });
    return () => { alive = false; };
  }, []);

  const loadDraft = (id: string) => {
    const d = drafts.find(x => x.id === id);
    if (!d || !d.embed) return;
    setS(formFromPayload(d.content ?? '', d.embed));
  };
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS(prev => ({ ...prev, [k]: v }));

  const payload = useMemo(() => buildPayload(s), [s]);
  const previewPayload = useMemo(() => toPreviewPayload(payload, s.imageMode, s.uploads), [payload, s.imageMode, s.uploads]);
  const chars = totalChars(payload);
  const overLimit =
    chars > LIMITS.total ||
    s.title.length > LIMITS.title ||
    s.description.length > LIMITS.description ||
    s.authorName.length > LIMITS.author ||
    s.footerText.length > LIMITS.footer ||
    s.fields.some(f => f.name.length > LIMITS.fieldName || f.value.length > LIMITS.fieldValue);
  const valid = isNonEmpty(payload) && !overLimit;

  const addField = () => setS(prev => prev.fields.length >= LIMITS.fields ? prev : ({ ...prev, fields: [...prev.fields, { name: '', value: '', inline: false }] }));
  const updateField = (i: number, patch: Partial<FieldRow>) => setS(prev => ({ ...prev, fields: prev.fields.map((f, idx) => idx === i ? { ...f, ...patch } : f) }));
  const removeField = (i: number) => setS(prev => ({ ...prev, fields: prev.fields.filter((_, idx) => idx !== i) }));

  const setImageMode = (slot: ImageSlot, mode: 'url' | 'file') => {
    setS(prev => {
      // Leaving file mode discards any picked file (and revokes its object URL).
      const u = prev.uploads[slot];
      if (mode === 'url' && u?.objectUrl) URL.revokeObjectURL(u.objectUrl);
      return {
        ...prev,
        imageMode: { ...prev.imageMode, [slot]: mode },
        uploads: { ...prev.uploads, [slot]: mode === 'url' ? null : prev.uploads[slot] },
      };
    });
  };
  const pickImage = (slot: ImageSlot, file: File) => {
    if (!file.type.startsWith('image/')) { pushToast('warn', 'Please choose an image file'); return; }
    if (file.size > MAX_IMAGE_BYTES) { pushToast('warn', `${file.name} is over 25MB`); return; }
    const ext = (file.name.split('.').pop() || file.type.split('/')[1] || 'png').toLowerCase();
    const name = `${SLOT_BASENAME[slot]}.${ext}`;
    const objectUrl = URL.createObjectURL(file);
    setS(prev => {
      const old = prev.uploads[slot];
      if (old?.objectUrl) URL.revokeObjectURL(old.objectUrl);
      return { ...prev, uploads: { ...prev.uploads, [slot]: { name, previewUrl: objectUrl, file, existingAttachmentId: null, objectUrl } } };
    });
  };
  const clearImage = (slot: ImageSlot) => {
    setS(prev => {
      const u = prev.uploads[slot];
      if (u?.objectUrl) URL.revokeObjectURL(u.objectUrl);
      return { ...prev, uploads: { ...prev.uploads, [slot]: null } };
    });
  };

  // Keep a ref to the latest uploads so the unmount cleanup revokes object
  // URLs that were created AFTER the first render (a plain []-deps effect would
  // close over the initial empty state and leak them).
  const uploadsRef = useRef(s.uploads);
  useEffect(() => { uploadsRef.current = s.uploads; }, [s.uploads]);
  useEffect(() => () => {
    for (const slot of IMAGE_SLOTS) {
      const u = uploadsRef.current[slot];
      if (u?.objectUrl) URL.revokeObjectURL(u.objectUrl);
    }
  }, []);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const content = s.content.trim();
      const newAttachments: SendAttachment[] = [];
      const keepIds: string[] = [];
      for (const slot of IMAGE_SLOTS) {
        if (s.imageMode[slot] !== 'file') continue;
        const u = s.uploads[slot];
        if (!u) continue;
        if (u.file) {
          newAttachments.push({ name: u.name, mimeType: u.file.type || 'application/octet-stream', bytes: new Uint8Array(await u.file.arrayBuffer()) });
        } else if (u.existingAttachmentId) {
          keepIds.push(u.existingAttachmentId);
        }
      }
      const atts = newAttachments.length ? newAttachments : undefined;
      const res = edit
        ? await api.messages.editEmbed(channelId, edit.messageId, payload, content, atts, keepIds.length ? keepIds : undefined)
        : await api.messages.sendEmbed(channelId, payload, content || undefined, atts);
      if (!res.ok) {
        pushToast('danger', `${edit ? 'Edit' : 'Send'} failed: ${res.error.message}`);
        return;
      }
      pushToast('ok', edit ? 'Embed updated' : 'Embed sent');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    const name = window.prompt('Draft name?');
    if (!name) return;
    // Drafts can't store file bytes. Drop image fields that point at an upload
    // (their attachment:// url would dangle), keeping URL-based images.
    const hasUpload = IMAGE_SLOTS.some(slot => s.imageMode[slot] === 'file' && s.uploads[slot]);
    const draftEmbed: EmbedPayload = { ...payload };
    if (s.imageMode.image === 'file' && s.uploads.image) delete draftEmbed.image;
    if (s.imageMode.thumbnail === 'file' && s.uploads.thumbnail) delete draftEmbed.thumbnail;
    if (s.imageMode.authorIcon === 'file' && s.uploads.authorIcon && draftEmbed.author) {
      const { iconUrl: _drop, ...rest } = draftEmbed.author; void _drop; draftEmbed.author = rest;
    }
    if (s.imageMode.footerIcon === 'file' && s.uploads.footerIcon && draftEmbed.footer) {
      const { iconUrl: _drop, ...rest } = draftEmbed.footer; void _drop; draftEmbed.footer = rest;
    }
    const res = await api.drafts.upsert({ name, guildId, channelId, content: s.content.trim() || null, embed: draftEmbed });
    if (!res.ok) { pushToast('danger', `Couldn't save draft: ${res.error.message}`); return; }
    pushToast('ok', hasUpload ? "Draft saved — uploaded images aren't kept in drafts" : 'Draft saved');
  };

  // Portal to <body> so the modal escapes the stacking context of whatever
  // rendered it (the composer, or a message row deep in the list) — otherwise
  // sibling chrome like the composer bar, member avatars, and unread pill
  // paint over the overlay. z-[70] matches the app's other top-level dialogs.
  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] animate-fade-in" onClick={onClose}>
      <div
        className="bg-bg-subtle border border-white/[0.06] rounded-xl w-[55rem] max-w-[94vw] max-h-[90vh] flex flex-col shadow-2xl animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-white/[0.04]">
          <h2 className="text-[18px] font-semibold text-fg">{edit ? 'Edit Embed' : 'Create an Embed'}</h2>
          <div className="flex items-center gap-3">
            {drafts.length > 0 && (
              <select aria-label="Load draft" defaultValue="" onChange={(e) => { if (e.target.value) loadDraft(e.target.value); }} className="bg-bg-input border border-white/[0.06] rounded-md text-[13px] text-fg-muted px-2.5 py-1.5 outline-none focus:border-accent">
                <option value="" disabled>Load draft…</option>
                {drafts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <button className="text-fg-muted hover:text-fg p-1 rounded" onClick={onClose} title="Close"><IconX size={18} stroke={2} /></button>
          </div>
        </div>

        {/* Body: form | preview */}
        <div className="flex min-h-0 flex-1">
          {/* Form */}
          <div className="flex-1 px-6 py-4 overflow-y-auto space-y-4 border-r border-white/[0.04]">
            <div>
              <label className={labelCls}>Message content <span className="text-fg-dim normal-case font-normal">(optional)</span></label>
              <input className={inputBase} value={s.content} onChange={(e) => set('content', e.target.value)} placeholder="Optional message text sent above the embed" />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className={labelCls}>Author</label>
                <input className={inputBase} value={s.authorName} onChange={(e) => set('authorName', e.target.value)} placeholder="Author name" />
              </div>
              <div className="w-20">
                <label className={labelCls}>Color</label>
                <div className="flex items-center gap-1.5">
                  <CheckBox checked={s.useColor} onChange={() => set('useColor', !s.useColor)} ariaLabel="Use color" />
                  <input type="color" value={s.color} disabled={!s.useColor} onChange={(e) => set('color', e.target.value)} className="h-8 w-9 bg-transparent disabled:opacity-40" />
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1"><label className={labelCls}>Author URL</label><input className={inputBase} value={s.authorUrl} onChange={(e) => set('authorUrl', e.target.value)} placeholder="https://…" /></div>
              <div className="flex-1">
                <EmbedImageField label="Author icon" slotKey="authorIcon" mode={s.imageMode.authorIcon} url={s.authorIcon}
                  upload={s.uploads.authorIcon} onModeChange={(m) => setImageMode('authorIcon', m)}
                  onUrlChange={(v) => set('authorIcon', v)} onPickFile={(f) => pickImage('authorIcon', f)} onClear={() => clearImage('authorIcon')} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Title</label>
              <input className={inputBase} value={s.title} onChange={(e) => set('title', e.target.value)} placeholder="Embed title" maxLength={LIMITS.title} />
            </div>
            <div>
              <label className={labelCls}>Title URL <span className="text-fg-dim normal-case font-normal">(optional)</span></label>
              <input className={inputBase} value={s.url} onChange={(e) => set('url', e.target.value)} placeholder="https://…" />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea className={`${inputBase} h-24 resize-none`} value={s.description} onChange={(e) => set('description', e.target.value)} placeholder="Embed description" maxLength={LIMITS.description} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-semibold text-fg-muted uppercase tracking-wide">Fields</label>
                <button onClick={addField} disabled={s.fields.length >= LIMITS.fields} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-dashed border-white/[0.12] text-[12px] text-fg-muted hover:text-fg hover:border-white/[0.25] disabled:opacity-40">
                  <IconPlus size={13} stroke={2} /> Add field
                </button>
              </div>
              <div className="space-y-2">
                {s.fields.map((f, i) => (
                  <div key={i} className="bg-bg border border-white/[0.05] rounded-md p-2 flex items-center gap-2">
                    <input className="w-28 bg-bg-input border border-white/[0.06] rounded px-2 py-1.5 text-[13px] text-fg outline-none focus:border-accent" value={f.name} onChange={(e) => updateField(i, { name: e.target.value })} placeholder="Field name" maxLength={LIMITS.fieldName} />
                    <input className="flex-1 bg-bg-input border border-white/[0.06] rounded px-2 py-1.5 text-[13px] text-fg outline-none focus:border-accent" value={f.value} onChange={(e) => updateField(i, { value: e.target.value })} placeholder="Field value" maxLength={LIMITS.fieldValue} />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <CheckBox checked={f.inline} onChange={() => updateField(i, { inline: !f.inline })} ariaLabel="Inline field" />
                      <span className="text-[12px] text-fg-muted select-none">inline</span>
                    </div>
                    <button onClick={() => removeField(i)} title="Remove field" className="text-fg-muted hover:text-danger p-1"><IconTrash size={15} stroke={1.75} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <EmbedImageField label="Thumbnail" slotKey="thumbnail" mode={s.imageMode.thumbnail} url={s.thumbnailUrl}
                  upload={s.uploads.thumbnail} onModeChange={(m) => setImageMode('thumbnail', m)}
                  onUrlChange={(v) => set('thumbnailUrl', v)} onPickFile={(f) => pickImage('thumbnail', f)} onClear={() => clearImage('thumbnail')} />
              </div>
              <div className="flex-1">
                <EmbedImageField label="Image" slotKey="image" mode={s.imageMode.image} url={s.imageUrl}
                  upload={s.uploads.image} onModeChange={(m) => setImageMode('image', m)}
                  onUrlChange={(v) => set('imageUrl', v)} onPickFile={(f) => pickImage('image', f)} onClear={() => clearImage('image')} />
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1"><label className={labelCls}>Footer</label><input className={inputBase} value={s.footerText} onChange={(e) => set('footerText', e.target.value)} placeholder="Footer text" maxLength={LIMITS.footer} /></div>
              <div className="flex-1">
                <EmbedImageField label="Footer icon" slotKey="footerIcon" mode={s.imageMode.footerIcon} url={s.footerIcon}
                  upload={s.uploads.footerIcon} onModeChange={(m) => setImageMode('footerIcon', m)}
                  onUrlChange={(v) => set('footerIcon', v)} onPickFile={(f) => pickImage('footerIcon', f)} onClear={() => clearImage('footerIcon')} />
              </div>
            </div>
            <div className="flex items-center gap-2 text-[13px] text-fg-muted select-none">
              <CheckBox checked={s.useTimestamp} onChange={() => set('useTimestamp', !s.useTimestamp)} ariaLabel="Add timestamp" /> Add timestamp (now)
            </div>
          </div>

          {/* Preview — on the real channel background so the embed panel
              stands out exactly as it will in a Discord channel. */}
          <div className="w-[22rem] px-5 py-4 flex flex-col bg-bg-sunken">
            <div className="text-[11px] font-bold tracking-wide text-fg-dim mb-2">LIVE PREVIEW</div>
            {s.content.trim() && <div className="text-[14px] text-fg mb-1.5 whitespace-pre-wrap">{s.content}</div>}
            {isNonEmpty(payload)
              ? <EmbedCard embed={payloadToSummary(previewPayload)} />
              : <div className="text-[13px] text-fg-dim italic">Add a title, description, or field to see a preview.</div>}
            <div className="flex-1" />
            {!edit && (
              <div className="text-[11px] text-fg-dim mt-3">Sending to <span className="text-fg-muted font-medium">#{channelName}</span></div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-between border-t border-white/[0.04]">
          <span className={`text-[12px] tabular-nums ${overLimit ? 'text-danger' : 'text-fg-dim'}`}>Total: {chars} / {LIMITS.total} characters</span>
          <div className="flex items-center gap-3">
            <button onClick={saveDraft} disabled={!isNonEmpty(payload)} className="px-4 py-2 rounded-md border border-white/[0.10] text-fg-muted text-[14px] hover:text-fg hover:border-white/[0.20] disabled:opacity-40">Save draft</button>
            <button onClick={submit} disabled={!valid || busy} className="px-5 py-2 rounded-md bg-accent text-white text-[14px] font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed">
              {busy ? (edit ? 'Saving…' : 'Sending…') : (edit ? 'Save' : 'Send')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Build form state for EDIT mode from a sent message: URL-only fields come from
// the embed payload, and any image field whose url matches a message attachment
// opens in upload mode bound to that existing attachment (kept on save).
export function formFromMessage(content: string, embed: MessageEmbedSummary, attachments: MessageAttachment[]): FormState {
  const base = formFromPayload(content, summaryToPayload(embed));
  const matchAttachment = (fieldUrl: string | null): MessageAttachment | null => {
    if (!fieldUrl) return null;
    const exact = attachments.find(a => a.url === fieldUrl);
    if (exact) return exact;
    // Filename fallback only for Discord-hosted URLs, so an external image URL
    // that merely shares a filename with an attachment isn't mistaken for one.
    const isDiscordCdn = /^https?:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//.test(fieldUrl);
    if (!isDiscordCdn) return null;
    return attachments.find(a => fieldUrl.split('?')[0]!.endsWith('/' + a.name)) ?? null;
  };
  const slotFor = (fieldUrl: string | null): { mode: 'url' | 'file'; upload: SlotUpload | null } => {
    const att = matchAttachment(fieldUrl);
    if (!att) return { mode: 'url', upload: null };
    return { mode: 'file', upload: { name: att.name, previewUrl: att.url, file: null, existingAttachmentId: att.id, objectUrl: null } };
  };
  const image = slotFor(embed.image?.url ?? null);
  const thumbnail = slotFor(embed.thumbnail?.url ?? null);
  const authorIcon = slotFor(embed.author?.iconUrl ?? null);
  const footerIcon = slotFor(embed.footer?.iconUrl ?? null);
  return {
    ...base,
    imageMode: { image: image.mode, thumbnail: thumbnail.mode, authorIcon: authorIcon.mode, footerIcon: footerIcon.mode },
    uploads: { image: image.upload, thumbnail: thumbnail.upload, authorIcon: authorIcon.upload, footerIcon: footerIcon.upload },
  };
}

// Exported for Task 4 (drafts) and Task 6 (edit prefill): build form state from a payload + content.
export function formFromPayload(content: string, p: EmbedPayload): FormState {
  return {
    content,
    authorName: p.author?.name ?? '', authorUrl: p.author?.url ?? '', authorIcon: p.author?.iconUrl ?? '',
    useColor: typeof p.color === 'number', color: typeof p.color === 'number' ? '#' + p.color.toString(16).padStart(6, '0') : DEFAULT_COLOR,
    title: p.title ?? '', url: p.url ?? '', description: p.description ?? '',
    fields: (p.fields ?? []).map(f => ({ name: f.name, value: f.value, inline: f.inline ?? false })),
    thumbnailUrl: p.thumbnail?.url ?? '', imageUrl: p.image?.url ?? '',
    footerText: p.footer?.text ?? '', footerIcon: p.footer?.iconUrl ?? '',
    useTimestamp: !!p.timestamp,
    imageMode: { image: 'url', thumbnail: 'url', authorIcon: 'url', footerIcon: 'url' },
    uploads: { image: null, thumbnail: null, authorIcon: null, footerIcon: null },
  };
}
