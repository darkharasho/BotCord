import { useEffect, useMemo } from 'react';

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|tiff?)$/i;

function isImageFile(f: File): boolean {
  if (f.type.startsWith('image/')) return true;
  return IMAGE_EXT_RE.test(f.name);
}

export function AttachmentTray({
  files, onRemove,
}: { files: File[]; onRemove: (idx: number) => void }) {
  const previews = useMemo(() => files.map(f => isImageFile(f) ? URL.createObjectURL(f) : null), [files]);
  useEffect(() => () => { previews.forEach(u => { if (u) URL.revokeObjectURL(u); }); }, [previews]);

  if (files.length === 0) return null;

  return (
    <div className="flex gap-2 px-3 py-2 border-b border-border bg-bg-sunken overflow-x-auto">
      {files.map((f, i) => (
        <div key={i} className="relative shrink-0 w-20 h-20 rounded bg-bg-subtle border border-border flex items-center justify-center text-[10px] text-fg-muted overflow-hidden">
          {previews[i]
            ? <img src={previews[i]!} alt={f.name} className="w-full h-full object-cover" />
            : <span className="px-1 text-center break-all">📄 {f.name.slice(0, 16)}</span>}
          <button
            onClick={() => onRemove(i)}
            className="absolute top-0 right-0 w-5 h-5 bg-danger text-white rounded-bl text-xs leading-none"
          >×</button>
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 truncate">
            {formatSize(f.size)}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
