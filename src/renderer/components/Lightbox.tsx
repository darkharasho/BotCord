import { useEffect, useState } from 'react';
import { IconX, IconExternalLink, IconDownload } from '@tabler/icons-react';

const listeners = new Set<(url: string | null) => void>();

export function openLightbox(url: string): void {
  for (const cb of listeners) cb(url);
}

export function Lightbox() {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const handler = (next: string | null) => setUrl(next);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setUrl(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url]);

  if (!url) return null;

  return (
    <div
      className="fixed inset-0 bg-black/85 flex items-center justify-center z-50"
      onClick={() => setUrl(null)}
    >
      <img
        src={url}
        alt=""
        className="max-w-[90vw] max-h-[85vh] object-contain rounded shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); window.botcord.system.openExternal(url); }}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-bg-subtle text-fg-muted hover:text-fg hover:bg-hover"
          title="Open in browser"
        >
          <IconExternalLink size={18} stroke={1.75} />
        </button>
        <a
          href={url}
          download
          onClick={(e) => e.stopPropagation()}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-bg-subtle text-fg-muted hover:text-fg hover:bg-hover"
          title="Download"
        >
          <IconDownload size={18} stroke={1.75} />
        </a>
        <button
          onClick={() => setUrl(null)}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-bg-subtle text-fg-muted hover:text-fg hover:bg-hover"
          title="Close (Esc)"
        >
          <IconX size={18} stroke={2} />
        </button>
      </div>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-fg-dim text-xs">
        Click outside or press Esc to close
      </div>
    </div>
  );
}
