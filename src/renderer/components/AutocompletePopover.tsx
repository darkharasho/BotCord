import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

export type AutocompleteItem = {
  key: string;
  label: ReactNode;
  hint?: ReactNode;
};

export function AutocompletePopover({
  title, items, selectedIdx, onPick,
}: {
  title: string;
  items: AutocompleteItem[];
  selectedIdx: number;
  onPick: (idx: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the selected row in view.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const row = container.querySelector(`[data-ac-idx="${selectedIdx}"]`) as HTMLElement | null;
    if (row) row.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (items.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-40">
      <div className="mx-auto max-w-[640px] bg-bg-subtle border border-border rounded-lg shadow-2xl overflow-hidden animate-fade-in-up origin-bottom">
        <div className="px-3 py-2 text-[11px] uppercase font-semibold text-fg-dim border-b border-border">
          {title}
        </div>
        <div ref={containerRef} className="max-h-64 overflow-y-auto py-1">
          {items.map((item, i) => (
            <button
              key={item.key}
              data-ac-idx={i}
              onMouseDown={(e) => { e.preventDefault(); onPick(i); }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-sm
                ${i === selectedIdx ? 'bg-hover text-fg' : 'text-fg-muted hover:bg-hover/50'}`}
            >
              <span className="truncate flex items-center gap-2">{item.label}</span>
              {item.hint && <span className="text-fg-dim text-xs shrink-0">{item.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
