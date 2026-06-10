// src/renderer/components/EmbedModal.tsx
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { pushToast } from './Toaster';
import { EmbedCard } from './EmbedCard';
import { payloadToSummary } from '../lib/embed-adapters';
import type { EmbedPayload } from '../../shared/domain';
import { IconX, IconPlus, IconTrash } from '@tabler/icons-react';

// Discord embed limits.
const LIMITS = { title: 256, description: 4096, fieldName: 256, fieldValue: 1024, footer: 2048, author: 256, fields: 25, total: 6000 };
const DEFAULT_COLOR = '#007f68'; // accent

type FieldRow = { name: string; value: string; inline: boolean };

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
};

const EMPTY: FormState = {
  content: '', authorName: '', authorUrl: '', authorIcon: '',
  useColor: true, color: DEFAULT_COLOR, title: '', url: '', description: '',
  fields: [], thumbnailUrl: '', imageUrl: '', footerText: '', footerIcon: '', useTimestamp: false,
};

// Build an EmbedPayload from the form, omitting empty values.
function buildPayload(s: FormState): EmbedPayload {
  const p: EmbedPayload = {};
  if (s.title.trim()) p.title = s.title.trim();
  if (s.description.trim()) p.description = s.description.trim();
  if (s.url.trim()) p.url = s.url.trim();
  if (s.useColor) p.color = parseInt(s.color.slice(1), 16);
  if (s.useTimestamp) p.timestamp = new Date().toISOString();
  if (s.footerText.trim()) {
    p.footer = s.footerIcon.trim() ? { text: s.footerText.trim(), iconUrl: s.footerIcon.trim() } : { text: s.footerText.trim() };
  }
  if (s.authorName.trim()) {
    const a: { name: string; url?: string; iconUrl?: string } = { name: s.authorName.trim() };
    if (s.authorUrl.trim()) a.url = s.authorUrl.trim();
    if (s.authorIcon.trim()) a.iconUrl = s.authorIcon.trim();
    p.author = a;
  }
  if (s.thumbnailUrl.trim()) p.thumbnail = { url: s.thumbnailUrl.trim() };
  if (s.imageUrl.trim()) p.image = { url: s.imageUrl.trim() };
  const fields = s.fields.filter(f => f.name.trim() && f.value.trim()).map(f => ({ name: f.name.trim(), value: f.value.trim(), inline: f.inline }));
  if (fields.length) p.fields = fields;
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
  channelId, guildId, channelName, onClose, edit, initial,
}: {
  channelId: string;
  guildId: string | null;
  channelName: string;
  onClose: () => void;
  // When present, the modal edits an existing message instead of sending a new one.
  edit?: { messageId: string };
  initial?: FormState;
}) {
  const [s, setS] = useState<FormState>(initial ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS(prev => ({ ...prev, [k]: v }));

  const payload = useMemo(() => buildPayload(s), [s]);
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

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    const content = s.content.trim();
    const res = edit
      ? await api.messages.editEmbed(channelId, edit.messageId, payload, content)
      : await api.messages.sendEmbed(channelId, payload, content || undefined);
    setBusy(false);
    if (!res.ok) {
      pushToast('danger', `${edit ? 'Edit' : 'Send'} failed: ${res.error.message}`);
      return;
    }
    pushToast('ok', edit ? 'Embed updated' : 'Embed sent');
    onClose();
  };

  const saveDraft = async () => {
    const name = window.prompt('Draft name?');
    if (!name) return;
    const res = await api.drafts.upsert({ name, guildId, channelId, content: s.content.trim() || null, embed: payload });
    pushToast(res.ok ? 'ok' : 'danger', res.ok ? 'Draft saved' : `Couldn't save draft: ${res.error.message}`);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div
        className="bg-bg-subtle border border-white/[0.06] rounded-xl w-[55rem] max-w-[94vw] max-h-[90vh] flex flex-col shadow-2xl animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-white/[0.04]">
          <h2 className="text-[18px] font-semibold text-fg">{edit ? 'Edit Embed' : 'Create an Embed'}</h2>
          <button className="text-fg-muted hover:text-fg p-1 rounded" onClick={onClose} title="Close"><IconX size={18} stroke={2} /></button>
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
                  <input type="checkbox" checked={s.useColor} onChange={(e) => set('useColor', e.target.checked)} className="accent-accent w-4 h-4" title="Use color" />
                  <input type="color" value={s.color} disabled={!s.useColor} onChange={(e) => set('color', e.target.value)} className="h-8 w-9 bg-transparent disabled:opacity-40" />
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1"><label className={labelCls}>Author URL</label><input className={inputBase} value={s.authorUrl} onChange={(e) => set('authorUrl', e.target.value)} placeholder="https://…" /></div>
              <div className="flex-1"><label className={labelCls}>Author icon URL</label><input className={inputBase} value={s.authorIcon} onChange={(e) => set('authorIcon', e.target.value)} placeholder="https://…" /></div>
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
                    <label className="text-[12px] text-fg-muted flex items-center gap-1 shrink-0"><input type="checkbox" checked={f.inline} onChange={(e) => updateField(i, { inline: e.target.checked })} className="accent-accent w-3.5 h-3.5" />inline</label>
                    <button onClick={() => removeField(i)} title="Remove field" className="text-fg-muted hover:text-danger p-1"><IconTrash size={15} stroke={1.75} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1"><label className={labelCls}>Thumbnail URL</label><input className={inputBase} value={s.thumbnailUrl} onChange={(e) => set('thumbnailUrl', e.target.value)} placeholder="https://…" /></div>
              <div className="flex-1"><label className={labelCls}>Image URL</label><input className={inputBase} value={s.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" /></div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1"><label className={labelCls}>Footer</label><input className={inputBase} value={s.footerText} onChange={(e) => set('footerText', e.target.value)} placeholder="Footer text" maxLength={LIMITS.footer} /></div>
              <div className="flex-1"><label className={labelCls}>Footer icon URL</label><input className={inputBase} value={s.footerIcon} onChange={(e) => set('footerIcon', e.target.value)} placeholder="https://…" /></div>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-fg-muted select-none">
              <input type="checkbox" checked={s.useTimestamp} onChange={(e) => set('useTimestamp', e.target.checked)} className="accent-accent w-4 h-4" /> Add timestamp (now)
            </label>
          </div>

          {/* Preview */}
          <div className="w-[22rem] px-5 py-4 flex flex-col">
            <div className="text-[11px] font-bold tracking-wide text-fg-dim mb-2">LIVE PREVIEW</div>
            {s.content.trim() && <div className="text-[14px] text-fg mb-1.5 whitespace-pre-wrap">{s.content}</div>}
            {isNonEmpty(payload)
              ? <EmbedCard embed={payloadToSummary(payload)} />
              : <div className="text-[13px] text-fg-dim italic">Add a title, description, or field to see a preview.</div>}
            <div className="flex-1" />
            <div className="text-[11px] text-fg-dim mt-3">Sending to <span className="text-fg-muted font-medium">#{channelName}</span></div>
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
    </div>
  );
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
  };
}
