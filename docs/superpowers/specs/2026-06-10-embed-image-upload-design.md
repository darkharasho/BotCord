# Embed Image Upload — Design

**Date:** 2026-06-10
**Status:** Approved (pending implementation plan)
**Builds on:** `2026-06-10-embed-composer-design.md` (the EmbedModal feature)

## Overview

Let users supply each of an embed's four image fields — **image, thumbnail,
author icon, footer icon** — either by URL (today's behavior) or by uploading a
local file. Works in both **create** and **edit** modes. Uploaded files ride
along with the message as attachments, referenced from the embed via Discord's
`attachment://<filename>` scheme.

## Mechanism

Discord embeds cannot carry raw bytes. Instead, a file is uploaded as a message
attachment, and the embed field points at it with `attachment://<filename>`.
`discord.js` (`EmbedBuilder.setImage`/`setThumbnail`, author `iconURL`, footer
`iconURL`) accepts an `attachment://…` URL and binds it to the matching attached
file. So `EmbedPayload` stays URL-only — an uploaded field simply holds
`attachment://image.png`, and the bytes are sent alongside.

discord.js version: **14.26.3**.

## Image slots

Four slots, each with a fixed attachment filename (extension derived from the
uploaded file's mime type, defaulting to the original extension or `png`):

| Slot | EmbedPayload target | Attachment name base |
|------|---------------------|----------------------|
| image | `image.url` | `image` |
| thumbnail | `thumbnail.url` | `thumbnail` |
| authorIcon | `author.iconUrl` | `author-icon` |
| footerIcon | `footer.iconUrl` | `footer-icon` |

Fixed per-slot names guarantee uniqueness within one embed (at most one of each),
so no filename collisions across slots.

## Renderer model (EmbedModal)

Add a per-slot upload structure to `FormState`. A slot is in **URL mode** (uses
the existing url string) when its upload entry is `null`, otherwise in **file
mode**:

```ts
type ImageSlot = 'image' | 'thumbnail' | 'authorIcon' | 'footerIcon';

type SlotUpload = {
  // The attachment filename, e.g. "image.png". Field url becomes attachment://<name>.
  name: string;
  // Preview shown in the control: object URL for a new file, or CDN url for an existing attachment.
  previewUrl: string;
  // Set when the slot holds a NEWLY picked local file (bytes to upload).
  file: File | null;
  // Set when editing and the slot maps to an EXISTING message attachment to keep.
  existingAttachmentId: string | null;
};

// In FormState:
uploads: Record<ImageSlot, SlotUpload | null>;
```

`buildPayload` resolves each image field: if `uploads[slot]` is set, the field
url is `attachment://${uploads[slot].name}`; otherwise the slot's url string (as
today). Field is omitted entirely when neither is present.

### Per-field control

Each of the four image inputs becomes a small control with a **URL / Upload**
two-state toggle:

- **URL mode:** the existing text input.
- **Upload mode:** a "Choose file" button; once chosen, a small thumbnail
  preview (the `previewUrl`), the filename, and a clear (×) button. Picking a
  file uses a hidden `<input type="file" accept="image/*">` (same approach as the
  composer's `onPick`). New files create an object URL for preview (revoked on
  clear/unmount).

Author/footer icon controls are the same but compact.

### Validation

- Accept image types only (`image/*`). Reject others with a toast.
- Max file size: reuse the composer's `25 * 1024 * 1024` cap; oversize → toast,
  no queue.
- A file-mode slot with no file chosen yet contributes nothing to the embed
  (treated as empty until a file is picked).

## Send path

### Create

Extend the send contract:

```ts
sendEmbed(channelId, embed, content?, attachments?: SendAttachment[]): Promise<Result<MessageSummary>>
```

Handler change (`messages.ts`): build the embed (its image urls already contain
`attachment://…`), map `attachments` to `AttachmentBuilder`s (reusing the exact
pattern in `sendWithAttachments`), and send `{ content, embeds: [embed], files }`.
`attachments` defaults to none — existing callers and behavior are unchanged.

On submit, the modal collects, for each slot whose `uploads[slot].file` is set, a
`SendAttachment { name, mimeType, bytes }` (name = the slot's attachment name).

### Edit

Extend the edit contract:

```ts
editEmbed(
  channelId, messageId, embed, content?,
  attachments?: SendAttachment[],     // NEW files to add
  keepAttachmentIds?: string[],       // EXISTING attachments to retain
): Promise<Result<MessageSummary>>
```

Handler calls:

```ts
msg.edit({
  embeds: [buildEmbed(embed)],
  ...(typeof content === 'string' ? { content } : {}),
  files: attachments.map(toAttachmentBuilder),                 // new uploads
  attachments: (keepAttachmentIds ?? []).map(id => ({ id })),  // existing to keep
});
```

discord.js semantics (to **verify as the first implementation step**): the
`attachments` array is the set of existing attachments to retain; `files` adds
new ones. The resulting attachment set = kept-existing + new-uploads. This makes
all four edit cases correct:

- **keep** an existing attachment → its id in `keepAttachmentIds`, no new file.
- **replace** → old id NOT in keep list, new file in `attachments`.
- **switch to URL** → old id not kept, no new file, field url is the URL.
- **switch to upload** (was URL) → new file added, field url `attachment://…`.

### Edit-mode initialization

The modal must open pre-filled with the message's existing attachment-backed
images. MessageGroup passes the full `MessageSummary` (it already has it). A new
exported initializer builds `FormState` from the message:

For each embed image field (`image`, `thumbnail`, `author.iconUrl`,
`footer.iconUrl`), decide URL vs existing-attachment by matching the field's url
against the message's `attachments[]`:

1. If an attachment's `url` equals the field url → existing-attachment slot:
   `{ name: att.name, previewUrl: att.url, file: null, existingAttachmentId: att.id }`.
2. Else, fall back to matching by filename (the field url path ends with
   `att.name`) → existing-attachment slot.
3. Else → URL mode (the field url string).

(Discord rewrites `attachment://x` to the CDN url in returned embed data, so a
sent attachment-image's embed url equals the message attachment url — hence the
match. External URLs match no attachment.)

`summaryToPayload`/`formFromPayload` remain for the URL-only parts and drafts;
the new initializer wraps them and adds the `uploads` map.

## Drafts

The SQLite drafts table cannot store file bytes. On **Save draft**, any slot in
file mode with a new local file is dropped (that image field is cleared in the
saved draft) and a toast notes it: "Uploaded images aren't saved in drafts —
other fields saved." URL-mode images persist normally. Loading a draft yields
URL-mode slots only.

## Error handling

Unchanged pattern: IPC returns `Result<T>`; failures surface via
`pushToast('danger', …)`. Discord upload/permission errors map to
`DISCORD_HTTP_ERROR` as in `sendWithAttachments`.

## Testing

- **Unit (EmbedModal, RTL):**
  - Toggling a slot to Upload and picking a file sets the field to
    `attachment://<name>` in the built payload and queues a `SendAttachment` on
    send (assert `sendEmbed` called with the attachment).
  - Oversize / non-image file is rejected (no queue, toast).
  - Edit init: a message whose embed image url matches an attachment opens in
    upload mode with that attachment's preview, and saving with no change passes
    the attachment id in `keepAttachmentIds` with no new files.
  - Save draft with a file-mode slot drops that image and toasts.
- **Backend:** follows repo convention (no unit test for the thin IPC handlers);
  verified by typecheck + the discord.js semantics check in Task 1 and manual
  E2E.
- Respect the vitest worker cap (≤2). Run via `npx vitest run <path>` to skip the
  native-rebuild pre/post hooks. The full suite requires `better-sqlite3` built
  for Node (the repo's `npm test` handles the rebuild dance).

## Out of scope (v1)

- Persisting uploaded image bytes in drafts.
- Re-ordering / multiple images per slot (Discord embeds have one of each).
- Editing/extending *non-embed* attachments already on a message (only the four
  embed-image attachments are managed; for embeds composed by this tool that is
  the complete attachment set).
- Drag-and-drop onto the image fields (file picker only; can follow up).

## Files touched

- `src/shared/ipc-contract.ts` — `sendEmbed` + `editEmbed` signatures.
- `src/preload/expose.ts` — both methods pass the new args.
- `src/main/ipc/messages.ts` — both handlers build/attach files; editEmbed keeps ids.
- `src/renderer/components/EmbedModal.tsx` — slot model, per-field upload control,
  build-on-submit, edit-mode init, draft handling.
- `src/renderer/components/MessageGroup.tsx` — pass the full message to the edit modal.
- Tests in `src/renderer/components/__tests__/EmbedModal.test.tsx`.
