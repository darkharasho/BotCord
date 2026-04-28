import type { MessageAttachment } from '../../shared/domain';

export function AttachmentInline({ attachment }: { attachment: MessageAttachment }) {
  const isImage = attachment.contentType?.startsWith('image/');
  if (isImage) {
    return (
      <a href={attachment.url} onClick={(e) => { e.preventDefault(); window.botcord.system.openExternal(attachment.url); }}>
        <img
          src={attachment.url}
          alt={attachment.name}
          className="rounded border border-border max-w-md max-h-96"
        />
      </a>
    );
  }
  return (
    <a
      href={attachment.url}
      onClick={(e) => { e.preventDefault(); window.botcord.system.openExternal(attachment.url); }}
      className="inline-flex items-center gap-2 px-3 py-2 bg-bg-subtle border border-border rounded text-sm hover:bg-bg-sunken"
    >
      <span>📎</span>
      <span className="font-medium">{attachment.name}</span>
      <span className="text-fg-muted text-xs">{formatBytes(attachment.size)}</span>
    </a>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
