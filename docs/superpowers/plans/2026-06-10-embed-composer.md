# Embed Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins compose, send, edit, and delete rich Discord embeds through their bot, via a modal launched from the channel composer and editable from the message hover menu.

**Architecture:** A single `EmbedModal` component (create + edit modes) with a live `EmbedCard` preview, reusing the existing `EmbedPayload` type, `buildEmbed()`, `messages.sendEmbed` handler, and the SQLite `drafts` backend. Two pure adapter functions bridge `EmbedPayload` ↔ `MessageEmbedSummary`. One new IPC handler, `messages.editEmbed`, is added for editing sent embeds.

**Tech Stack:** Electron + React + TypeScript, discord.js, better-sqlite3, vitest + @testing-library/react. Tailwind theme tokens (`bg-bg-subtle`, `bg-bg-input`, `accent`, `fg`, `fg-muted`, `fg-dim`, `danger`, `border`, `hover`).

**Spec:** `docs/superpowers/specs/2026-06-10-embed-composer-design.md`

**Note on test scope:** The existing `src/main/ipc/messages.ts` handlers (e.g. `sendEmbed`) have no unit tests — they are thin wrappers verified by typecheck and manual use. This plan follows that convention for `editEmbed` (Task 2) and applies TDD to the genuinely testable units: the pure adapters (Task 1) and the `EmbedModal` component (Tasks 3–4).

**Test runner:** This repo's `vitest.config.ts` already caps workers at 2. Run `npx vitest run <path>` (single run) for the commands below.

---

### Task 1: Embed shape adapters

Two pure functions converting between the compose/send shape (`EmbedPayload`) and the rendered shape (`MessageEmbedSummary`). The preview reuses `EmbedCard` (which takes `MessageEmbedSummary`); edit mode pre-fills from a sent message's `MessageEmbedSummary`.

**Files:**
- Create: `src/renderer/lib/embed-adapters.ts`
- Test: `src/renderer/lib/__tests__/embed-adapters.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/renderer/lib/__tests__/embed-adapters.test.ts
import { describe, it, expect } from 'vitest';
import { payloadToSummary, summaryToPayload } from '../embed-adapters';
import type { EmbedPayload, MessageEmbedSummary } from '../../../shared/domain';

describe('payloadToSummary', () => {
  it('maps a full payload and fills summary-only fields', () => {
    const p: EmbedPayload = {
      title: 'T', description: 'D', url: 'https://x.test', color: 0x007f68,
      timestamp: '2026-06-10T00:00:00.000Z',
      footer: { text: 'F', iconUrl: 'https://i.test/f.png' },
      author: { name: 'A', url: 'https://a.test', iconUrl: 'https://i.test/a.png' },
      thumbnail: { url: 'https://i.test/t.png' },
      image: { url: 'https://i.test/img.png' },
      fields: [{ name: 'N', value: 'V', inline: true }],
    };
    const s = payloadToSummary(p);
    expect(s.type).toBe('rich');
    expect(s.title).toBe('T');
    expect(s.color).toBe(0x007f68);
    expect(s.timestamp).toBe(Date.parse('2026-06-10T00:00:00.000Z'));
    expect(s.image).toEqual({ url: 'https://i.test/img.png', width: null, height: null });
    expect(s.author).toEqual({ name: 'A', url: 'https://a.test', iconUrl: 'https://i.test/a.png' });
    expect(s.footer).toEqual({ text: 'F', iconUrl: 'https://i.test/f.png' });
    expect(s.fields).toEqual([{ name: 'N', value: 'V', inline: true }]);
    expect(s.provider).toBeNull();
    expect(s.video).toBeNull();
  });

  it('maps an empty payload to all-null with empty fields', () => {
    const s = payloadToSummary({});
    expect(s.title).toBeNull();
    expect(s.color).toBeNull();
    expect(s.timestamp).toBeNull();
    expect(s.fields).toEqual([]);
  });
});

describe('summaryToPayload', () => {
  it('drops auto fields and converts timestamp to ISO', () => {
    const s: MessageEmbedSummary = {
      type: 'rich', title: 'T', description: null, url: null, color: 0x123456,
      image: { url: 'https://i.test/img.png', width: 100, height: 50 },
      thumbnail: null,
      author: { name: 'A', url: null, iconUrl: null },
      footer: { text: 'F', iconUrl: null },
      provider: { name: 'P', url: null },
      timestamp: Date.parse('2026-06-10T00:00:00.000Z'),
      video: { url: 'https://v.test', width: null, height: null },
      fields: [{ name: 'N', value: 'V', inline: false }],
    };
    const p = summaryToPayload(s);
    expect(p.title).toBe('T');
    expect(p.color).toBe(0x123456);
    expect(p.timestamp).toBe('2026-06-10T00:00:00.000Z');
    expect(p.image).toEqual({ url: 'https://i.test/img.png' });
    expect(p.author).toEqual({ name: 'A' });
    expect(p.footer).toEqual({ text: 'F' });
    expect(p.fields).toEqual([{ name: 'N', value: 'V', inline: false }]);
    expect('description' in p).toBe(false);
  });

  it('round-trips a payload through summary and back', () => {
    const p: EmbedPayload = {
      title: 'T', description: 'D', color: 0x007f68,
      fields: [{ name: 'N', value: 'V', inline: true }],
    };
    expect(summaryToPayload(payloadToSummary(p))).toEqual(p);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/lib/__tests__/embed-adapters.test.ts`
Expected: FAIL — cannot find module `../embed-adapters`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/renderer/lib/embed-adapters.ts
import type { EmbedPayload, MessageEmbedSummary } from '../../shared/domain';

// EmbedPayload (compose/send input) -> MessageEmbedSummary (what EmbedCard renders).
// Fills the summary-only fields EmbedCard expects but the payload never carries.
export function payloadToSummary(p: EmbedPayload): MessageEmbedSummary {
  return {
    type: 'rich',
    title: p.title ?? null,
    description: p.description ?? null,
    url: p.url ?? null,
    color: typeof p.color === 'number' ? p.color : null,
    image: p.image ? { url: p.image.url, width: null, height: null } : null,
    thumbnail: p.thumbnail ? { url: p.thumbnail.url, width: null, height: null } : null,
    author: p.author
      ? { name: p.author.name, url: p.author.url ?? null, iconUrl: p.author.iconUrl ?? null }
      : null,
    footer: p.footer ? { text: p.footer.text, iconUrl: p.footer.iconUrl ?? null } : null,
    provider: null,
    timestamp: p.timestamp ? Date.parse(p.timestamp) : null,
    video: null,
    fields: (p.fields ?? []).map(f => ({ name: f.name, value: f.value, inline: f.inline ?? false })),
  };
}

// MessageEmbedSummary (a sent message's embed) -> EmbedPayload (editable form input).
// Drops auto-generated fields (provider, video, image/thumbnail dimensions).
export function summaryToPayload(s: MessageEmbedSummary): EmbedPayload {
  const out: EmbedPayload = {};
  if (s.title) out.title = s.title;
  if (s.description) out.description = s.description;
  if (s.url) out.url = s.url;
  if (s.color != null) out.color = s.color;
  if (s.timestamp != null) out.timestamp = new Date(s.timestamp).toISOString();
  if (s.footer) {
    out.footer = s.footer.iconUrl ? { text: s.footer.text, iconUrl: s.footer.iconUrl } : { text: s.footer.text };
  }
  if (s.author) {
    const a: { name: string; url?: string; iconUrl?: string } = { name: s.author.name };
    if (s.author.url) a.url = s.author.url;
    if (s.author.iconUrl) a.iconUrl = s.author.iconUrl;
    out.author = a;
  }
  if (s.thumbnail) out.thumbnail = { url: s.thumbnail.url };
  if (s.image) out.image = { url: s.image.url };
  if (s.fields.length) out.fields = s.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/lib/__tests__/embed-adapters.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/embed-adapters.ts src/renderer/lib/__tests__/embed-adapters.test.ts
git commit -m "feat(embeds): add EmbedPayload <-> MessageEmbedSummary adapters"
```

---

### Task 2: `messages.editEmbed` backend

Add an IPC handler to edit a message's embed (and optional content). Mirrors the existing `sendEmbed` handler and reuses `buildEmbed()`. Wired through the contract, channel map, preload, and renderer api.

**Files:**
- Modify: `src/shared/ipc-contract.ts` (add method to `messages` interface + `IPC_CHANNELS` map)
- Modify: `src/main/ipc/messages.ts` (register handler)
- Modify: `src/preload/expose.ts` (add api method)

- [ ] **Step 1: Add the contract method**

In `src/shared/ipc-contract.ts`, in the `messages:` interface, immediately after the `edit(...)` line, add:

```typescript
    editEmbed(channelId: string, messageId: string, embed: EmbedPayload, content?: string): Promise<Result<MessageSummary>>;
```

(`EmbedPayload` is already imported in this file — it's used by `sendEmbed` on the line above.)

- [ ] **Step 2: Add the channel key**

In the same file, in the `IPC_CHANNELS` object, immediately after the `'messages.sendEmbed': 'messages.sendEmbed',` line, add:

```typescript
  'messages.editEmbed': 'messages.editEmbed',
```

- [ ] **Step 3: Register the main-process handler**

In `src/main/ipc/messages.ts`, immediately after the `ipcMain.handle(IPC_CHANNELS['messages.sendEmbed'], ...)` block closes (the `});` ending that handler), add:

```typescript
  ipcMain.handle(IPC_CHANNELS['messages.editEmbed'], async (_, channelId: unknown, messageId: unknown, embed: unknown, content?: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof messageId !== 'string' || typeof embed !== 'object' || embed === null) {
      return err('INTERNAL', 'invalid arguments');
    }
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    const channel = (got as { ok: true; channel: SendableChannel }).channel;
    try {
      const msg = await channel.messages.fetch(messageId);
      const updated = await msg.edit({
        content: typeof content === 'string' ? content : '',
        embeds: [buildEmbed(embed as EmbedPayload)],
      });
      return ok(summarizeMessage(updated));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });
```

Note: `SendableChannel.send`'s `Message.edit` is available on the fetched message. The `SendOpts` type is for `send`; `edit` accepts `{ content, embeds }` directly on the discord.js `Message`, so no `SendOpts` change is needed.

- [ ] **Step 4: Add the preload api method**

In `src/preload/expose.ts`, in the `messages:` object, immediately after the `sendEmbed: (...)` entry, add:

```typescript
    editEmbed: (channelId, messageId, embed, content) =>
      invoke(IPC_CHANNELS['messages.editEmbed'], channelId, messageId, embed, content),
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If the project uses a different typecheck script, e.g. `npm run typecheck`, use that — check `package.json` `scripts`.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-contract.ts src/main/ipc/messages.ts src/preload/expose.ts
git commit -m "feat(embeds): add messages.editEmbed IPC handler"
```

---

### Task 3: `EmbedModal` — compose & send

The modal: left-column form (all embed fields + content line), right-column live preview via `EmbedCard`, footer with live char count and Send. Create mode only in this task; drafts (Task 4) and edit mode (Task 6) build on it.

**Files:**
- Create: `src/renderer/components/EmbedModal.tsx`
- Test: `src/renderer/components/__tests__/EmbedModal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/components/__tests__/EmbedModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmbedModal } from '../EmbedModal';

vi.mock('../../lib/api', () => ({
  api: {
    messages: {
      sendEmbed: vi.fn(async () => ({ ok: true, data: { id: 'm1' } })),
      editEmbed: vi.fn(async () => ({ ok: true, data: { id: 'm1' } })),
    },
    drafts: {
      list: vi.fn(async () => ({ ok: true, data: [] })),
      upsert: vi.fn(async () => ({ ok: true, data: {} })),
    },
  },
}));

// EmbedCard pulls in markdown/lightbox; stub it to a marker for these tests.
vi.mock('../EmbedCard', () => ({
  EmbedCard: ({ embed }: { embed: { title: string | null } }) => <div data-testid="preview">{embed.title}</div>,
}));

describe('<EmbedModal> create mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('disables Send until the embed is non-empty', () => {
    render(<EmbedModal channelId="c1" guildId="g1" channelName="general" onClose={() => {}} />);
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Embed title'), { target: { value: 'Hello' } });
    expect(send).toBeEnabled();
  });

  it('reflects the title in the live preview', () => {
    render(<EmbedModal channelId="c1" guildId="g1" channelName="general" onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Embed title'), { target: { value: 'Hi there' } });
    expect(screen.getByTestId('preview')).toHaveTextContent('Hi there');
  });

  it('sends the built payload and closes on success', async () => {
    const onClose = vi.fn();
    const { api } = await import('../../lib/api');
    render(<EmbedModal channelId="c1" guildId="g1" channelName="general" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Embed title'), { target: { value: 'T' } });
    fireEvent.change(screen.getByPlaceholderText('Optional message text sent above the embed'), { target: { value: 'ping' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.messages.sendEmbed).toHaveBeenCalled());
    const call = (api.messages.sendEmbed as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('c1');
    expect(call[1]).toMatchObject({ title: 'T' });
    expect(call[2]).toBe('ping');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('adds and removes a field row', () => {
    render(<EmbedModal channelId="c1" guildId="g1" channelName="general" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add field/i }));
    expect(screen.getByPlaceholderText('Field name')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Remove field'));
    expect(screen.queryByPlaceholderText('Field name')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/__tests__/EmbedModal.test.tsx`
Expected: FAIL — cannot find module `../EmbedModal`.

- [ ] **Step 3: Write the implementation**

```tsx
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
      ? await api.messages.editEmbed(channelId, edit.messageId, payload, content || undefined)
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/__tests__/EmbedModal.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/EmbedModal.tsx src/renderer/components/__tests__/EmbedModal.test.tsx
git commit -m "feat(embeds): add EmbedModal compose + send"
```

---

### Task 4: Drafts — load saved embeds in `EmbedModal`

Add a "Load draft…" dropdown to the header that lists embed-bearing drafts and populates the form. (Saving is already wired in Task 3's `saveDraft`.)

**Files:**
- Modify: `src/renderer/components/EmbedModal.tsx`
- Modify: `src/renderer/components/__tests__/EmbedModal.test.tsx`

- [ ] **Step 1: Add the failing test**

Append this test inside the `describe('<EmbedModal> create mode', ...)` block in `EmbedModal.test.tsx`:

```tsx
  it('loads an embed draft into the form', async () => {
    const { api } = await import('../../lib/api');
    (api.drafts.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      data: [{ id: 'd1', name: 'Promo', guildId: 'g1', channelId: 'c1', content: 'hey', embed: { title: 'Promo Title' }, createdAt: 1, updatedAt: 1 }],
    });
    render(<EmbedModal channelId="c1" guildId="g1" channelName="general" onClose={() => {}} />);
    await waitFor(() => screen.getByRole('option', { name: 'Promo' }));
    fireEvent.change(screen.getByLabelText('Load draft'), { target: { value: 'd1' } });
    expect((screen.getByPlaceholderText('Embed title') as HTMLInputElement).value).toBe('Promo Title');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/__tests__/EmbedModal.test.tsx -t "loads an embed draft"`
Expected: FAIL — no element with accessible name `Load draft`.

- [ ] **Step 3: Implement the dropdown**

In `EmbedModal.tsx`, add these imports/state and the header control.

Add to the import from React: `useEffect` (change `import { useMemo, useState }` to `import { useEffect, useMemo, useState }`).

Add `DraftRow` to the domain import:
```typescript
import type { EmbedPayload, DraftRow } from '../../shared/domain';
```

Inside the component, after the `const [busy, setBusy] = useState(false);` line, add:

```typescript
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
```

In the header, replace the single close button line with a draft selector beside it. Change:

```tsx
          <button className="text-fg-muted hover:text-fg p-1 rounded" onClick={onClose} title="Close"><IconX size={18} stroke={2} /></button>
```

to:

```tsx
          <div className="flex items-center gap-3">
            {drafts.length > 0 && (
              <select aria-label="Load draft" defaultValue="" onChange={(e) => { if (e.target.value) loadDraft(e.target.value); }} className="bg-bg-input border border-white/[0.06] rounded-md text-[13px] text-fg-muted px-2.5 py-1.5 outline-none focus:border-accent">
                <option value="" disabled>Load draft…</option>
                {drafts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <button className="text-fg-muted hover:text-fg p-1 rounded" onClick={onClose} title="Close"><IconX size={18} stroke={2} /></button>
          </div>
```

- [ ] **Step 4: Run the full modal test file**

Run: `npx vitest run src/renderer/components/__tests__/EmbedModal.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/EmbedModal.tsx src/renderer/components/__tests__/EmbedModal.test.tsx
git commit -m "feat(embeds): load saved drafts in EmbedModal"
```

---

### Task 5: Launch `EmbedModal` from the channel composer `+` menu

Add a "Create embed" item to the plus-menu in `Composer.tsx`, next to "Create a poll" (guild mode only), opening `EmbedModal` for the current channel.

**Files:**
- Modify: `src/renderer/components/Composer.tsx`

- [ ] **Step 1: Add the import**

In `src/renderer/components/Composer.tsx`, after `import { PollModal } from './PollModal';` add:

```typescript
import { EmbedModal } from './EmbedModal';
```

And add `IconLayoutCards` to the existing `@tabler/icons-react` import list on the line that currently imports `IconChartBar` etc.:

```typescript
import { IconCirclePlus, IconMoodSmile, IconSend2, IconUpload, IconChartBar, IconLayoutCards, IconX } from '@tabler/icons-react';
```

- [ ] **Step 2: Add state**

After the `const [pollOpen, setPollOpen] = useState(false);` line, add:

```typescript
  const [embedOpen, setEmbedOpen] = useState(false);
```

- [ ] **Step 3: Add the menu item**

The Composer accepts `channelId`, `guildId`, and a `channelName` is not currently a prop — pass the channel id as the display name fallback. In the plus-menu, immediately after the "Create a poll" `<button>...</button>` (still inside the `{!isDM && (...)}` is the poll only; add this as a sibling, also gated `!isDM`). Insert right after the poll button:

```tsx
                  {!isDM && (
                    <button
                      onClick={() => { setPlusMenuOpen(false); setEmbedOpen(true); }}
                      disabled={!channelId}
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-fg hover:bg-hover disabled:opacity-40"
                    >
                      <IconLayoutCards size={18} stroke={1.75} className="text-fg-muted" />
                      Create an embed
                    </button>
                  )}
```

- [ ] **Step 4: Render the modal**

Immediately after the existing line near the end of the component:

```tsx
      {pollOpen && channelId && <PollModal channelId={channelId} guildId={guildId} onClose={() => setPollOpen(false)} />}
```

add:

```tsx
      {embedOpen && channelId && <EmbedModal channelId={channelId} guildId={guildId} channelName={channelId} onClose={() => setEmbedOpen(false)} />}
```

Note: `channelName={channelId}` is a deliberate minimal choice — the Composer doesn't receive the human channel name. The "Sending to #…" line will show the id. If a friendly name is wanted, thread a `channelName` prop from `ChannelView` in a follow-up; out of scope here.

- [ ] **Step 5: Verify build + existing tests**

Run: `npx tsc --noEmit && npx vitest run src/renderer/components/__tests__/EmbedModal.test.tsx`
Expected: typecheck clean; modal tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/Composer.tsx
git commit -m "feat(embeds): launch EmbedModal from composer + menu"
```

---

### Task 6: Edit/delete sent embeds from the message hover menu

Route the hover "Edit" action to `EmbedModal` (edit mode) when the message is the bot's own and has exactly one `rich` embed. All other messages keep the inline text editor. Delete is already wired (`api.messages.delete`) — no change.

**Files:**
- Modify: `src/renderer/components/MessageGroup.tsx`

- [ ] **Step 1: Add imports**

In `src/renderer/components/MessageGroup.tsx`, add near the other component imports:

```typescript
import { EmbedModal, formFromPayload } from './EmbedModal';
import { summaryToPayload } from '../lib/embed-adapters';
```

- [ ] **Step 2: Add edit-target state + helpers**

Inside `MessageGroup`, after the `const [editingId, setEditingId] = useState<string | null>(null);` line, add:

```typescript
  // When set, edit a sent embed via the modal instead of the inline editor.
  const [embedEdit, setEmbedEdit] = useState<MessageSummary | null>(null);

  // A message is embed-editable when the bot owns it and it carries exactly
  // one rich embed (link-preview / multi-embed messages stay text-editable).
  const isEmbedEditable = (m: MessageSummary) =>
    bot?.id === m.authorId && m.embeds.length === 1 && m.embeds[0]!.type === 'rich';

  // Route edit to the embed modal or the inline text editor.
  const startEdit = (m: MessageSummary) => {
    if (isEmbedEditable(m)) setEmbedEdit(m);
    else setEditingId(m.id);
  };
```

- [ ] **Step 3: Route the three `onEdit` call sites through `startEdit`**

There are three `onEdit` handlers that currently call `setEditingId(...)`. Replace each:

In `onContextMenu` (the `buildMessageMenu` call):
```typescript
      onEdit: () => setEditingId(m.id),
```
becomes
```typescript
      onEdit: () => startEdit(m),
```

In the head `<HoverActions ... onEdit={() => setEditingId(head.id)} />`:
```typescript
          onEdit={() => setEditingId(head.id)}
```
becomes
```typescript
          onEdit={() => startEdit(head)}
```

In the per-message `<HoverActions ... onEdit={() => setEditingId(m.id)} />`:
```typescript
              onEdit={() => setEditingId(m.id)}
```
becomes
```typescript
              onEdit={() => startEdit(m)}
```

- [ ] **Step 4: Render the edit modal**

Just before the final closing `</div>` of the component's returned tree (after the `modState && ...` dialog lines), add:

```tsx
      {embedEdit && (
        <EmbedModal
          channelId={embedEdit.channelId}
          guildId={embedEdit.guildId}
          channelName={embedEdit.channelId}
          edit={{ messageId: embedEdit.id }}
          initial={formFromPayload(embedEdit.content, summaryToPayload(embedEdit.embeds[0]!))}
          onClose={() => setEmbedEdit(null)}
        />
      )}
```

- [ ] **Step 5: Typecheck + full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck clean; all tests PASS (existing + new adapter/modal tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/MessageGroup.tsx
git commit -m "feat(embeds): edit sent embeds from the message hover menu"
```

---

### Task 7: Manual verification

No code; confirm end-to-end with a real bot + guild.

- [ ] **Step 1: Launch the app**

Run the project's dev command (e.g. `npm run dev` — confirm in `package.json` `scripts`).

- [ ] **Step 2: Create & send**

In a text channel, open the composer `+` menu → "Create an embed". Fill title/description/a field/color, watch the live preview update, set a content line, click Send. Confirm the embed posts to the channel and matches the preview.

- [ ] **Step 3: Edit**

Hover the embed you just sent → 3-dots → Edit. Confirm the modal opens pre-filled (content + all fields). Change the title, Save. Confirm the message updates in place and shows "edited".

- [ ] **Step 4: Delete**

Hover the embed → 3-dots → Delete. Confirm it's removed.

- [ ] **Step 5: Drafts**

Open the modal, build an embed, Save draft (name it). Close, reopen the modal, choose it from "Load draft…", confirm fields populate.

- [ ] **Step 6: Negative checks**

Confirm: Send is disabled for an empty embed; the char counter turns red past 6000; a normal text-only message still opens the inline editor (not the modal) on Edit; a link-preview message (paste a URL, send) does NOT offer embed-edit.

---

## Self-Review Notes

- **Spec coverage:** Compose modal (T3), live preview via EmbedCard (T3), content line (T3), full field set + validation/limits (T3), drafts load/save (T3 save, T4 load), `+`-menu launch (T5), edit via hover menu for own+single-rich (T6), new `editEmbed` handler (T2), adapters (T1), delete reuse (T6 note), manual E2E (T7). All spec sections map to a task.
- **Type consistency:** `EmbedPayload`, `MessageEmbedSummary`, `DraftRow`, `FormState`, `payloadToSummary`/`summaryToPayload`, `formFromPayload`, `buildPayload`, `api.messages.editEmbed`/`sendEmbed`, `api.drafts.list`/`upsert` are used consistently across tasks.
- **Known minimal choices (documented, in scope):** `channelName` is passed the channel id (Composer/MessageGroup lack the friendly name); threading the real name is a follow-up. Single-embed rich-only editing matches the spec's out-of-scope list.
