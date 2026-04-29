import { useEffect, useRef, useState } from 'react';
import { IconX, IconExternalLink, IconDownload } from '@tabler/icons-react';

const listeners = new Set<(url: string | null) => void>();

export function openLightbox(url: string): void {
  for (const cb of listeners) cb(url);
}

const ZOOM_LEVEL = 2.25;
// Mouse-up treated as a click (not a drag) when the pointer hasn't moved
// more than this many pixels since mousedown.
const CLICK_THRESHOLD = 4;

export function Lightbox() {
  const [url, setUrl] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // Drag state lives in refs (no need to re-render mid-drag).
  const dragStart = useRef<{ x: number; y: number; pan: { x: number; y: number }; moved: boolean } | null>(null);

  useEffect(() => {
    const handler = (next: string | null) => setUrl(next);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  // Reset zoom whenever the lightbox opens for a different image.
  useEffect(() => {
    setZoomed(false);
    setPan({ x: 0, y: 0 });
  }, [url]);

  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUrl(null);
      else if (e.key === '0') { setZoomed(false); setPan({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url]);

  // Window-level mouse listeners while a drag is in progress, so the drag
  // continues even if the cursor leaves the image element.
  useEffect(() => {
    if (!zoomed) return;
    const onMove = (e: MouseEvent) => {
      const start = dragStart.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!start.moved && (Math.abs(dx) > CLICK_THRESHOLD || Math.abs(dy) > CLICK_THRESHOLD)) {
        start.moved = true;
      }
      if (start.moved) setPan({ x: start.pan.x + dx, y: start.pan.y + dy });
    };
    const onUp = () => { dragStart.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [zoomed]);

  if (!url) return null;

  const onImgMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    e.stopPropagation();
    e.preventDefault(); // suppress native image drag
    if (!zoomed) {
      // Wait for the click event (below) to flip into zoomed mode.
      return;
    }
    dragStart.current = { x: e.clientX, y: e.clientY, pan, moved: false };
  };

  const onImgClick = (e: React.MouseEvent<HTMLImageElement>) => {
    e.stopPropagation();
    if (zoomed) {
      // If the user dragged, the mouseup handler already cleared dragStart;
      // a true click (no drag) zooms back out.
      const wasDrag = dragStart.current?.moved;
      if (wasDrag) return;
      setZoomed(false);
      setPan({ x: 0, y: 0 });
    } else {
      setZoomed(true);
    }
  };

  const transform = zoomed
    ? `translate(${pan.x}px, ${pan.y}px) scale(${ZOOM_LEVEL})`
    : 'translate(0, 0) scale(1)';

  return (
    <div
      className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 animate-fade-in overflow-hidden"
      onClick={() => setUrl(null)}
    >
      <img
        src={url}
        alt=""
        draggable={false}
        className={`max-w-[90vw] max-h-[85vh] object-contain rounded shadow-2xl animate-lightbox-in select-none
          ${zoomed
            ? (dragStart.current?.moved ? 'cursor-grabbing' : 'cursor-grab')
            : 'cursor-zoom-in'}`}
        style={{
          transform,
          transition: dragStart.current ? 'none' : 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'transform',
        }}
        onMouseDown={onImgMouseDown}
        onClick={onImgClick}
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
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-fg-dim text-xs select-none">
        {zoomed ? 'Drag to pan · click to zoom out · Esc to close' : 'Click to zoom · Esc to close'}
      </div>
    </div>
  );
}
