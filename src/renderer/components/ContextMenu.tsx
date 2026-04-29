import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// One Discord-style right-click menu open at a time. Consumers don't render
// it themselves — they call openContextMenu(event, items) and we render via
// a top-level <ContextMenuHost /> mounted in the renderer root.

export type ContextMenuEntry =
  | { type: 'item'; label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }
  | { type: 'separator' };

type Position = { x: number; y: number };
type State = { items: ContextMenuEntry[]; pos: Position } | null;

let setStateRef: ((s: State) => void) | null = null;
let escAttached = false;

export function openContextMenu(event: { preventDefault: () => void; clientX: number; clientY: number }, items: ContextMenuEntry[]): void {
  event.preventDefault();
  if (!setStateRef) return;
  setStateRef({ items, pos: { x: event.clientX, y: event.clientY } });
}

export function closeContextMenu(): void {
  if (setStateRef) setStateRef(null);
}

// Mounted once at the app root. Owns the open state and renders the menu
// via a portal so positioning isn't tripped up by ancestor transforms.
export function ContextMenuHost() {
  const [state, setState] = useState<State>(null);

  useEffect(() => {
    setStateRef = setState;
    return () => { if (setStateRef === setState) setStateRef = null; };
  }, []);

  useEffect(() => {
    if (escAttached) return;
    escAttached = true;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeContextMenu(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); escAttached = false; };
  }, []);

  if (!state) return null;
  return createPortal(<ContextMenu items={state.items} pos={state.pos} />, document.body);
}

const MIN_W = 200;
const ITEM_H = 32;

function ContextMenu({ items, pos }: { items: ContextMenuEntry[]; pos: Position }) {
  const ref = useRef<HTMLDivElement>(null);
  const [resolvedPos, setResolvedPos] = useState<Position>(pos);

  // Clamp the rendered menu inside the viewport once we know its size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let { x, y } = pos;
    if (x + rect.width + margin > window.innerWidth) x = Math.max(margin, window.innerWidth - rect.width - margin);
    if (y + rect.height + margin > window.innerHeight) y = Math.max(margin, window.innerHeight - rect.height - margin);
    setResolvedPos({ x, y });
  }, [pos, items]);

  const itemHeight = items.filter(e => e.type === 'item').length * ITEM_H;
  void itemHeight;

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }} />
      <div
        ref={ref}
        role="menu"
        className="fixed z-[61] min-w-[200px] py-1.5 border border-white/[0.08] rounded-md shadow-2xl animate-pop-in origin-top-left"
        style={{ left: resolvedPos.x, top: resolvedPos.y, minWidth: MIN_W, backgroundColor: '#28282d' }}
      >
        {items.map((entry, i) => {
          if (entry.type === 'separator') {
            return <div key={i} className="my-1 mx-2 border-t border-white/[0.06]" />;
          }
          return (
            <button
              key={i}
              role="menuitem"
              disabled={entry.disabled}
              // Suppress focus shift so editor-targeted actions (Paste, Cut,
              // replaceMisspelling) still see the original input as the
              // focused element when they invoke webContents.* in main.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { entry.onClick(); closeContextMenu(); }}
              className={`w-full flex items-center justify-between gap-3 px-2.5 py-1.5 text-[13px] text-left transition-colors mx-1 rounded
                ${entry.disabled
                  ? 'text-fg-dim cursor-not-allowed'
                  : entry.danger
                    ? 'text-danger hover:bg-danger hover:text-white'
                    : 'text-fg hover:bg-accent hover:text-white'}`}
              style={{ width: 'calc(100% - 8px)' }}
            >
              <span className="truncate">{entry.label}</span>
              {entry.icon && <span className="shrink-0 opacity-80">{entry.icon}</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}
