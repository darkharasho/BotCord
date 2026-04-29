import { useEffect, useMemo } from 'react';
import { IconX, IconFile } from '@tabler/icons-react';

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
    <div className="flex gap-3 px-3 py-3 border-b border-border bg-bg-sunken overflow-x-auto">
      {files.map((f, i) => (
        <div
          key={i}
          className="group relative shrink-0 w-[216px] h-[216px] rounded-lg bg-bg-subtle border border-white/[0.06] overflow-hidden flex flex-col"
        >
          {previews[i]
            ? <img src={previews[i]!} alt={f.name} className="flex-1 min-h-0 w-full object-cover" />
            : (
              <div className="flex-1 min-h-0 w-full flex items-center justify-center text-fg-muted">
                <IconFile size={48} stroke={1.25} />
              </div>
            )}
          <div className="px-2.5 py-1.5 bg-bg-input border-t border-white/[0.04]">
            <div className="text-[12px] text-fg truncate" title={f.name}>{f.name}</div>
            <div className="text-[11px] text-fg-dim">{formatSize(f.size)}</div>
          </div>
          <button
            onClick={() => onRemove(i)}
            className="absolute top-2 right-2 w-7 h-7 rounded-md bg-bg-sunken/90 hover:bg-danger text-fg-muted hover:text-white border border-white/[0.06] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-150 shadow"
            title="Remove"
          >
            <IconX size={14} stroke={2} />
          </button>
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
