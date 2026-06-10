# Embed Image Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each of an embed's four image fields (image, thumbnail, author icon, footer icon) be supplied by URL or by uploading a local file, in both create and edit modes.

**Architecture:** Uploaded files ride along with the message as attachments; the embed field references them via `attachment://<filename>`. The send/edit IPC handlers gain optional `attachments` (new files) and, for edit, `keepAttachmentIds` (existing attachments to retain). EmbedModal grows a per-slot URL/Upload control backed by a small `uploads` state map; a new presentational `EmbedImageField` component keeps the modal readable.

**Tech Stack:** Electron + React + TS, discord.js 14.26.3 (`AttachmentBuilder`, `EmbedBuilder.setImage`/`setThumbnail`, `Message.edit` with `files`/`attachments`), vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-10-embed-image-upload-design.md`

**Test/runtime note:** Run tests with `npx vitest run <path>` (skips the native-rebuild hooks). The full suite needs `better-sqlite3` built for Node; if the app was run (`npm run dev`), it's built for Electron and db tests will fail to load it — rebuild for Node with `npm rebuild better-sqlite3`, run, then `npx electron-rebuild -f --only better-sqlite3` to restore. Typecheck with `npm run typecheck` (covers BOTH the renderer and the main-process `tsconfig.node.json`, which uses `exactOptionalPropertyTypes` — always run it, not just `npx tsc --noEmit`).

---

### Task 1: Backend — carry attachments through sendEmbed and editEmbed

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/expose.ts`
- Modify: `src/main/ipc/messages.ts`

- [ ] **Step 1: Confirm the discord.js edit semantics**

Read `node_modules/discord.js/typings/index.d.ts` for `MessageEditOptions` (search `interface MessageEditOptions`). Confirm:
- `files?` adds new attachments.
- `attachments?` is the list of EXISTING attachments to RETAIN (accepts `Attachment` instances / `JSONEncodable<AttachmentPayload>`); omitting an existing attachment from this list removes it.

Note the finding in your report. If the typings contradict this (e.g. `attachments` has different semantics), STOP and report NEEDS_CONTEXT before changing handlers — the whole edit flow depends on this.

- [ ] **Step 2: Update the contract signatures**

In `src/shared/ipc-contract.ts`, replace the `sendEmbed` line in the `messages` interface:
```typescript
    sendEmbed(channelId: string, embed: EmbedPayload, content?: string): Promise<Result<MessageSummary>>;
```
with:
```typescript
    sendEmbed(channelId: string, embed: EmbedPayload, content?: string, attachments?: SendAttachment[]): Promise<Result<MessageSummary>>;
```
and replace the `editEmbed` line:
```typescript
    editEmbed(channelId: string, messageId: string, embed: EmbedPayload, content?: string): Promise<Result<MessageSummary>>;
```
with:
```typescript
    editEmbed(channelId: string, messageId: string, embed: EmbedPayload, content?: string, attachments?: SendAttachment[], keepAttachmentIds?: string[]): Promise<Result<MessageSummary>>;
```
`SendAttachment` is already imported in this file (used by `sendWithAttachments`). If not, add it to the existing `import type { … } from './domain'` line.

- [ ] **Step 3: Update the preload methods**

In `src/preload/expose.ts`, replace the `sendEmbed` and `editEmbed` entries in the `messages` object:
```typescript
    sendEmbed: (channelId, embed, content) =>
      invoke(IPC_CHANNELS['messages.sendEmbed'], channelId, embed, content),
```
→
```typescript
    sendEmbed: (channelId, embed, content, attachments) =>
      invoke(IPC_CHANNELS['messages.sendEmbed'], channelId, embed, content, attachments),
```
and
```typescript
    editEmbed: (channelId, messageId, embed, content) =>
      invoke(IPC_CHANNELS['messages.editEmbed'], channelId, messageId, embed, content),
```
→
```typescript
    editEmbed: (channelId, messageId, embed, content, attachments, keepAttachmentIds) =>
      invoke(IPC_CHANNELS['messages.editEmbed'], channelId, messageId, embed, content, attachments, keepAttachmentIds),
```

- [ ] **Step 4: Add a shared attachment-builder helper in messages.ts**

In `src/main/ipc/messages.ts`, add the import for `Attachment` to the existing discord.js import (it currently imports `EmbedBuilder, AttachmentBuilder, ChannelType, type Message, …`):
```typescript
import { EmbedBuilder, AttachmentBuilder, ChannelType, type Message, type Attachment, type MessageEditOptions, type ForumChannel, type MediaChannel } from 'discord.js';
```
Then, just below the `buildEmbed` function definition, add:
```typescript
// Map IPC SendAttachment payloads to discord.js AttachmentBuilders. Throws on a
// malformed entry (same validation as messages.sendWithAttachments).
const toAttachmentBuilders = (attachments: SendAttachment[]): AttachmentBuilder[] =>
  attachments.map((a, i) => {
    if (typeof a?.name !== 'string' || !(a.bytes instanceof Uint8Array)) {
      throw new Error(`attachments[${i}] is malformed`);
    }
    return new AttachmentBuilder(Buffer.from(a.bytes), { name: a.name });
  });
```

- [ ] **Step 5: Update the sendEmbed handler**

Replace the whole `ipcMain.handle(IPC_CHANNELS['messages.sendEmbed'], …)` block with:
```typescript
  ipcMain.handle(IPC_CHANNELS['messages.sendEmbed'], async (_, channelId: unknown, embed: unknown, content?: unknown, attachments?: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof embed !== 'object' || embed === null) return err('INTERNAL', 'invalid arguments');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    let files: AttachmentBuilder[] = [];
    try {
      if (Array.isArray(attachments)) files = toAttachmentBuilders(attachments as SendAttachment[]);
    } catch (e) {
      return err('INTERNAL', e instanceof Error ? e.message : String(e));
    }
    try {
      const sendOpts: SendOpts = { embeds: [buildEmbed(embed as EmbedPayload)] };
      if (typeof content === 'string') sendOpts.content = content;
      if (files.length) sendOpts.files = files;
      const msg = await (got as { ok: true; channel: SendableChannel }).channel.send(sendOpts);
      return ok(summarizeMessage(msg));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });
```

- [ ] **Step 6: Update the editEmbed handler**

Replace the whole `ipcMain.handle(IPC_CHANNELS['messages.editEmbed'], …)` block with:
```typescript
  ipcMain.handle(IPC_CHANNELS['messages.editEmbed'], async (_, channelId: unknown, messageId: unknown, embed: unknown, content?: unknown, attachments?: unknown, keepAttachmentIds?: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof messageId !== 'string' || typeof embed !== 'object' || embed === null) {
      return err('INTERNAL', 'invalid arguments');
    }
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    const channel = (got as { ok: true; channel: SendableChannel }).channel;
    let files: AttachmentBuilder[] = [];
    try {
      if (Array.isArray(attachments)) files = toAttachmentBuilders(attachments as SendAttachment[]);
    } catch (e) {
      return err('INTERNAL', e instanceof Error ? e.message : String(e));
    }
    const keepIds = Array.isArray(keepAttachmentIds)
      ? keepAttachmentIds.filter((v): v is string => typeof v === 'string')
      : [];
    try {
      const msg = await channel.messages.fetch(messageId);
      // Retain only the existing attachments the caller still references; any
      // not listed here are dropped. New uploads are appended via `files`.
      const kept: Attachment[] = Array.from(msg.attachments.values()).filter(a => keepIds.includes(a.id));
      const editOpts: MessageEditOptions = {
        embeds: [buildEmbed(embed as EmbedPayload)],
        attachments: kept,
      };
      if (typeof content === 'string') editOpts.content = content;
      if (files.length) editOpts.files = files;
      const updated = await msg.edit(editOpts);
      return ok(summarizeMessage(updated));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });
```
Note: `msg.attachments` is a discord.js `Collection<string, Attachment>` on the fetched `Message`. The `SendableChannel.messages.fetch(id)` overload already returns `Message`, so `.attachments`, `.edit`, and the `Attachment` type all resolve.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean (both renderer and `tsconfig.node.json`).

- [ ] **Step 8: Commit**
```bash
git add src/shared/ipc-contract.ts src/preload/expose.ts src/main/ipc/messages.ts
git commit -m "feat(embeds): carry attachments through sendEmbed/editEmbed"
```

---

### Task 2: Renderer — image-slot model + EmbedImageField (create mode)

Add the per-slot upload state and a presentational `EmbedImageField` control, and wire create-mode build/submit. Edit-mode init is Task 3; draft handling is Task 4.

**Files:**
- Create: `src/renderer/components/EmbedImageField.tsx`
- Modify: `src/renderer/components/EmbedModal.tsx`
- Test: `src/renderer/components/__tests__/EmbedModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside the `describe('<EmbedModal> create mode', …)` block in `EmbedModal.test.tsx`:
```tsx
  it('uploads a local image: sends attachment:// url + the file', async () => {
    const { api } = await import('../../lib/api');
    render(<EmbedModal channelId="c1" guildId="g1" channelName="general" onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Embed title'), { target: { value: 'T' } });
    // Switch the Image slot to Upload mode.
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    // Pick a file via the slot's hidden input.
    const input = screen.getByTestId('file-input-image') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => screen.getByText('image.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.messages.sendEmbed).toHaveBeenCalled());
    const call = (api.messages.sendEmbed as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1].image).toEqual({ url: 'attachment://image.png' });
    const atts = call[3];
    expect(atts).toHaveLength(1);
    expect(atts[0].name).toBe('image.png');
    expect(atts[0].bytes).toBeInstanceOf(Uint8Array);
  });
```
Add this helper near the top of the test file (after the imports), so `URL.createObjectURL` exists in jsdom:
```tsx
beforeAll(() => {
  // jsdom lacks object-URL APIs used by the image preview.
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
});
```
(Import `beforeAll` from vitest in the existing import line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/__tests__/EmbedModal.test.tsx -t "uploads a local image"`
Expected: FAIL — no "Upload image" button.

- [ ] **Step 3: Create the EmbedImageField component**

Create `src/renderer/components/EmbedImageField.tsx`:
```tsx
import { IconX } from '@tabler/icons-react';

const inputBase =
  'w-full bg-bg-input border border-white/[0.06] rounded-md px-3 py-2 text-[14px] text-fg ' +
  'placeholder:text-fg-dim outline-none transition-colors duration-150 focus:border-accent';
const labelCls = 'block text-[12px] font-semibold text-fg-muted mb-1.5 uppercase tracking-wide';

// One embed image field, switchable between a URL input and a local-file upload
// with a thumbnail preview. Stateless: the parent owns mode/url/upload.
export function EmbedImageField({
  label, slotKey, mode, url, upload, onModeChange, onUrlChange, onPickFile, onClear,
}: {
  label: string;
  slotKey: string;
  mode: 'url' | 'file';
  url: string;
  upload: { previewUrl: string; name: string } | null;
  onModeChange: (m: 'url' | 'file') => void;
  onUrlChange: (v: string) => void;
  onPickFile: (file: File) => void;
  onClear: () => void;
}) {
  const tab = (m: 'url' | 'file', text: string, ariaLabel: string) => (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => onModeChange(m)}
      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
        mode === m ? 'bg-accent/20 text-accent' : 'text-fg-dim hover:text-fg-muted'
      }`}
    >{text}</button>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className={labelCls}>{label}</label>
        <div className="flex items-center gap-1">
          {tab('url', 'URL', `URL ${label.toLowerCase()}`)}
          {tab('file', 'Upload', `Upload ${label.toLowerCase()}`)}
        </div>
      </div>

      {mode === 'url' ? (
        <input className={inputBase} value={url} onChange={(e) => onUrlChange(e.target.value)} placeholder="https://…" />
      ) : upload ? (
        <div className="flex items-center gap-2 bg-bg-input border border-white/[0.06] rounded-md px-2 py-1.5">
          <img src={upload.previewUrl} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
          <span className="text-[12px] text-fg-muted truncate flex-1">{upload.name}</span>
          <button type="button" onClick={onClear} title="Remove image" className="text-fg-muted hover:text-danger p-1 shrink-0">
            <IconX size={14} stroke={2} />
          </button>
        </div>
      ) : (
        <label className="flex items-center justify-center gap-2 bg-bg-input border border-dashed border-white/[0.12] rounded-md px-3 py-2.5 text-[13px] text-fg-muted hover:text-fg hover:border-white/[0.25] cursor-pointer transition-colors">
          Choose image…
          <input
            data-testid={`file-input-${slotKey}`}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = ''; }}
          />
        </label>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the slot model into EmbedModal**

In `src/renderer/components/EmbedModal.tsx`:

(a) Add imports:
```typescript
import { EmbedImageField } from './EmbedImageField';
```
Add `SendAttachment` to the domain import:
```typescript
import type { EmbedPayload, DraftRow, SendAttachment } from '../../shared/domain';
```

(b) Add slot types + constants near the top (after the existing `type FieldRow`):
```typescript
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
```

(c) Extend `FormState` with two records:
```typescript
  imageMode: Record<ImageSlot, 'url' | 'file'>;
  uploads: Record<ImageSlot, SlotUpload | null>;
```

(d) Extend `EMPTY`:
```typescript
  imageMode: { image: 'url', thumbnail: 'url', authorIcon: 'url', footerIcon: 'url' },
  uploads: { image: null, thumbnail: null, authorIcon: null, footerIcon: null },
```

(e) In `buildPayload`, add a slot-url resolver and use it for the four image fields. Add at the top of `buildPayload`:
```typescript
  const slotUrl = (slot: ImageSlot, urlStr: string): string =>
    s.imageMode[slot] === 'file' && s.uploads[slot] ? `attachment://${s.uploads[slot]!.name}` : urlStr.trim();
```
Then change the four field resolutions. Replace the author icon line inside the author block:
```typescript
    if (s.authorIcon.trim()) a.iconUrl = s.authorIcon.trim();
```
with:
```typescript
    const aIcon = slotUrl('authorIcon', s.authorIcon);
    if (aIcon) a.iconUrl = aIcon;
```
Replace the footer block:
```typescript
  if (s.footerText.trim()) {
    p.footer = s.footerIcon.trim() ? { text: s.footerText.trim(), iconUrl: s.footerIcon.trim() } : { text: s.footerText.trim() };
  }
```
with:
```typescript
  if (s.footerText.trim()) {
    const fIcon = slotUrl('footerIcon', s.footerIcon);
    p.footer = fIcon ? { text: s.footerText.trim(), iconUrl: fIcon } : { text: s.footerText.trim() };
  }
```
Replace the thumbnail and image lines:
```typescript
  if (s.thumbnailUrl.trim()) p.thumbnail = { url: s.thumbnailUrl.trim() };
  if (s.imageUrl.trim()) p.image = { url: s.imageUrl.trim() };
```
with:
```typescript
  const thumb = slotUrl('thumbnail', s.thumbnailUrl);
  if (thumb) p.thumbnail = { url: thumb };
  const img = slotUrl('image', s.imageUrl);
  if (img) p.image = { url: img };
```

(f) Add slot handlers inside the component (after the existing `removeField`):
```typescript
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
```

(g) Revoke object URLs on unmount. Add near the other effects:
```typescript
  useEffect(() => () => {
    for (const slot of IMAGE_SLOTS) {
      const u = s.uploads[slot];
      if (u?.objectUrl) URL.revokeObjectURL(u.objectUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

(h) Collect attachments + keep-ids and pass them to the API in `submit`. Replace the submit body's content/res section:
```typescript
      const content = s.content.trim();
      const res = edit
        ? await api.messages.editEmbed(channelId, edit.messageId, payload, content)
        : await api.messages.sendEmbed(channelId, payload, content || undefined);
```
with:
```typescript
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
```

(i) Replace the four image inputs in the form JSX with `EmbedImageField`. Replace the author-icon input (inside the Author URL row) — change the second column:
```tsx
              <div className="flex-1"><label className={labelCls}>Author icon URL</label><input className={inputBase} value={s.authorIcon} onChange={(e) => set('authorIcon', e.target.value)} placeholder="https://…" /></div>
```
with:
```tsx
              <div className="flex-1">
                <EmbedImageField label="Author icon" slotKey="authorIcon" mode={s.imageMode.authorIcon} url={s.authorIcon}
                  upload={s.uploads.authorIcon} onModeChange={(m) => setImageMode('authorIcon', m)}
                  onUrlChange={(v) => set('authorIcon', v)} onPickFile={(f) => pickImage('authorIcon', f)} onClear={() => clearImage('authorIcon')} />
              </div>
```
Replace the Thumbnail/Image row:
```tsx
            <div className="flex gap-3">
              <div className="flex-1"><label className={labelCls}>Thumbnail URL</label><input className={inputBase} value={s.thumbnailUrl} onChange={(e) => set('thumbnailUrl', e.target.value)} placeholder="https://…" /></div>
              <div className="flex-1"><label className={labelCls}>Image URL</label><input className={inputBase} value={s.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" /></div>
            </div>
```
with:
```tsx
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
```
Replace the footer-icon input — change the Footer icon column:
```tsx
              <div className="flex-1"><label className={labelCls}>Footer icon URL</label><input className={inputBase} value={s.footerIcon} onChange={(e) => set('footerIcon', e.target.value)} placeholder="https://…" /></div>
```
with:
```tsx
              <div className="flex-1">
                <EmbedImageField label="Footer icon" slotKey="footerIcon" mode={s.imageMode.footerIcon} url={s.footerIcon}
                  upload={s.uploads.footerIcon} onModeChange={(m) => setImageMode('footerIcon', m)}
                  onUrlChange={(v) => set('footerIcon', v)} onPickFile={(f) => pickImage('footerIcon', f)} onClear={() => clearImage('footerIcon')} />
              </div>
```

(j) Update `formFromPayload` to include the new fields (URL mode, no uploads) so drafts/edit-URL prefill keeps compiling. In its returned object add:
```typescript
    imageMode: { image: 'url', thumbnail: 'url', authorIcon: 'url', footerIcon: 'url' },
    uploads: { image: null, thumbnail: null, authorIcon: null, footerIcon: null },
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/renderer/components/__tests__/EmbedModal.test.tsx`
Expected: PASS (the new upload test + all prior tests). Run `npm run typecheck` — expect clean.

- [ ] **Step 6: Commit**
```bash
git add src/renderer/components/EmbedImageField.tsx src/renderer/components/EmbedModal.tsx src/renderer/components/__tests__/EmbedModal.test.tsx
git commit -m "feat(embeds): URL-or-upload control for embed image fields (create)"
```

---

### Task 3: Renderer — edit-mode init from existing attachments

When editing, image fields backed by a message attachment must open in upload mode showing that attachment, and re-saving must retain it (via `keepAttachmentIds`). MessageGroup passes the full message.

**Files:**
- Modify: `src/renderer/components/EmbedModal.tsx`
- Modify: `src/renderer/components/MessageGroup.tsx`
- Test: `src/renderer/components/__tests__/EmbedModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level test file (a new `describe`):
```tsx
describe('<EmbedModal> edit mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens an attachment-backed image in upload mode and keeps it on save', async () => {
    const { api } = await import('../../lib/api');
    const attachments = [{ id: 'att1', name: 'photo.png', url: 'https://cdn.test/photo.png', size: 10, contentType: 'image/png', width: null, height: null }];
    const embed = {
      type: 'rich', title: 'T', description: null, url: null, color: null,
      image: { url: 'https://cdn.test/photo.png', width: null, height: null },
      thumbnail: null, author: null, footer: null, provider: null, timestamp: null, video: null, fields: [],
    };
    render(<EmbedModal channelId="c1" guildId="g1" channelName="general" edit={{ messageId: 'm1' }}
      initialMessage={{ content: '', embed, attachments }} onClose={() => {}} />);
    // The Image slot shows the existing attachment filename in upload mode.
    await waitFor(() => screen.getByText('photo.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.messages.editEmbed).toHaveBeenCalled());
    const call = (api.messages.editEmbed as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[2].image).toEqual({ url: 'attachment://photo.png' }); // embed payload
    expect(call[4]).toBeUndefined();                                   // no new files
    expect(call[5]).toEqual(['att1']);                                 // kept attachment id
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/__tests__/EmbedModal.test.tsx -t "attachment-backed image"`
Expected: FAIL — `initialMessage` prop not handled.

- [ ] **Step 3: Add the edit initializer + prop**

In `src/renderer/components/EmbedModal.tsx`:

(a) Add the `MessageAttachment` + `MessageEmbedSummary` types to the domain import:
```typescript
import type { EmbedPayload, DraftRow, SendAttachment, MessageAttachment, MessageEmbedSummary } from '../../shared/domain';
```
Add `summaryToPayload` to the adapters import (alongside `payloadToSummary`):
```typescript
import { payloadToSummary, summaryToPayload } from '../lib/embed-adapters';
```

(b) Add a new exported initializer at the bottom of the file (next to `formFromPayload`):
```typescript
// Build form state for EDIT mode from a sent message: URL-only fields come from
// the embed payload, and any image field whose url matches a message attachment
// opens in upload mode bound to that existing attachment (kept on save).
export function formFromMessage(content: string, embed: MessageEmbedSummary, attachments: MessageAttachment[]): FormState {
  const base = formFromPayload(content, summaryToPayload(embed));
  const matchAttachment = (fieldUrl: string | null): MessageAttachment | null => {
    if (!fieldUrl) return null;
    return attachments.find(a => a.url === fieldUrl)
      ?? attachments.find(a => fieldUrl.split('?')[0]!.endsWith('/' + a.name))
      ?? null;
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
```

(c) Add an `initialMessage` prop and use it to seed state. Change the component signature to add the prop:
```typescript
  edit?: { messageId: string };
  initial?: FormState;
  initialMessage?: { content: string; embed: MessageEmbedSummary; attachments: MessageAttachment[] };
```
and change the state initializer:
```typescript
  const [s, setS] = useState<FormState>(initial ?? EMPTY);
```
to:
```typescript
  const [s, setS] = useState<FormState>(
    initial ?? (initialMessage ? formFromMessage(initialMessage.content, initialMessage.embed, initialMessage.attachments) : EMPTY),
  );
```

- [ ] **Step 4: Wire MessageGroup to pass the message**

In `src/renderer/components/MessageGroup.tsx`, replace the edit-modal render:
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
with:
```tsx
      {embedEdit && (
        <EmbedModal
          channelId={embedEdit.channelId}
          guildId={embedEdit.guildId}
          channelName={embedEdit.channelId}
          edit={{ messageId: embedEdit.id }}
          initialMessage={{ content: embedEdit.content, embed: embedEdit.embeds[0]!, attachments: embedEdit.attachments }}
          onClose={() => setEmbedEdit(null)}
        />
      )}
```
Then remove the now-unused imports `formFromPayload` and `summaryToPayload` from MessageGroup if nothing else uses them (grep the file first; `EmbedModal` import stays). If `formFromPayload`/`summaryToPayload` are unused after this change, change the import line `import { EmbedModal, formFromPayload } from './EmbedModal';` to `import { EmbedModal } from './EmbedModal';` and delete `import { summaryToPayload } from '../lib/embed-adapters';`.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/renderer/components/__tests__/EmbedModal.test.tsx` (expect all pass) and `npm run typecheck` (expect clean — including no unused-import errors in MessageGroup).

- [ ] **Step 6: Commit**
```bash
git add src/renderer/components/EmbedModal.tsx src/renderer/components/MessageGroup.tsx src/renderer/components/__tests__/EmbedModal.test.tsx
git commit -m "feat(embeds): edit-mode image upload — keep or replace existing attachments"
```

---

### Task 4: Drafts — drop file-backed images on save

A saved draft can't hold file bytes; dropping them keeps drafts coherent.

**Files:**
- Modify: `src/renderer/components/EmbedModal.tsx`
- Test: `src/renderer/components/__tests__/EmbedModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside `describe('<EmbedModal> create mode', …)`:
```tsx
  it('drops uploaded images when saving a draft and warns', async () => {
    const { api } = await import('../../lib/api');
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('My Draft');
    render(<EmbedModal channelId="c1" guildId="g1" channelName="general" onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Embed title'), { target: { value: 'T' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    const input = screen.getByTestId('file-input-image') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })] } });
    await waitFor(() => screen.getByText('image.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.drafts.upsert).toHaveBeenCalled());
    const draft = (api.drafts.upsert as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(draft.embed.image).toBeUndefined(); // file-backed image not persisted
    promptSpy.mockRestore();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/__tests__/EmbedModal.test.tsx -t "drops uploaded images"`
Expected: FAIL — the draft embed still carries `image: { url: 'attachment://…' }`.

- [ ] **Step 3: Implement draft-safe payload**

In `saveDraft`, build a payload that excludes file-backed image slots. Replace the `saveDraft` body:
```typescript
  const saveDraft = async () => {
    const name = window.prompt('Draft name?');
    if (!name) return;
    const res = await api.drafts.upsert({ name, guildId, channelId, content: s.content.trim() || null, embed: payload });
    pushToast(res.ok ? 'ok' : 'danger', res.ok ? 'Draft saved' : `Couldn't save draft: ${res.error.message}`);
  };
```
with:
```typescript
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
```

- [ ] **Step 4: Verify**

Run: `npx vitest run src/renderer/components/__tests__/EmbedModal.test.tsx` (all pass) and `npm run typecheck` (clean).

- [ ] **Step 5: Commit**
```bash
git add src/renderer/components/EmbedModal.tsx src/renderer/components/__tests__/EmbedModal.test.tsx
git commit -m "feat(embeds): exclude uploaded images from saved drafts"
```

---

### Task 5: Manual verification

No code. Requires a real bot + guild and a running app (`npm run dev`; if better-sqlite3 errors, run `npx electron-rebuild -f --only better-sqlite3`).

- [ ] **Step 1: Create with an uploaded image**

Compose an embed, switch the Image field to Upload, choose a local PNG. Confirm the preview thumbnail appears and the live embed preview shows the image. Send. Confirm in the channel the embed renders the image, hosted as an attachment.

- [ ] **Step 2: All four slots**

Repeat for thumbnail, author icon, and footer icon (mix of URL and uploaded across slots). Confirm each renders correctly.

- [ ] **Step 3: Edit — keep**

Hover the embed → Edit. Confirm the uploaded image opens in Upload mode showing the existing image. Change only the title, Save. Confirm the image is preserved (not dropped).

- [ ] **Step 4: Edit — replace and switch-to-URL**

Edit again: replace the uploaded image with a different local file → Save → confirm the new image shows. Edit once more: switch that slot to URL, paste an image URL → Save → confirm it swaps to the URL image and the old attachment is gone.

- [ ] **Step 5: Drafts**

Compose with an uploaded image + a title, Save draft → confirm the toast notes uploaded images aren't kept. Reload the modal, load the draft → confirm the title is restored and the image slot is empty/URL mode.

- [ ] **Step 6: Validation**

Try a non-image file and an oversize (>25 MB) file → confirm both are rejected with a toast and nothing is queued.

---

## Self-Review Notes

- **Spec coverage:** `attachment://` mechanism + 4 slots (T2 model), send carries files (T1/T2), edit keeps/replaces via keepAttachmentIds (T1/T3), edit-mode init matching attachments (T3), URL/Upload control + preview + validation (T2), drafts drop file slots + toast (T4), manual E2E (T5). All spec sections map to a task.
- **Type consistency:** `ImageSlot`, `SlotUpload`, `SLOT_BASENAME`, `IMAGE_SLOTS`, `slotUrl`, `formFromMessage`, `initialMessage` prop, `api.messages.sendEmbed(…, attachments?)` / `editEmbed(…, attachments?, keepAttachmentIds?)`, and the `toAttachmentBuilders` helper are used consistently across tasks.
- **Known limitations (in scope, documented):** uploaded bytes not persisted in drafts; only the embed's own image attachments are managed on edit; file-picker only (no drag-drop).
