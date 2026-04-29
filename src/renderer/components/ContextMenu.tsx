import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// One Discord-style right-click menu open at a time. Consumers don't render
// it themselves — they call openContextMenu(event, items) and we render via
// a top-level <ContextMenuHost /> mounted in the renderer root.

export type ContextMenuEntry =
  | {
      type: 'item';
      label: string;
      icon?: ReactNode;
      onClick?: () => void;
      danger?: boolean;
      disabled?: boolean;
      // When present, hovering this item opens a submenu instead of clicking.
      // onClick is ignored if submenu is non-empty.
      submenu?: ContextMenuEntry[];
      // Optional tooltip — shown via title attribute when disabled.
      title?: string;
    }
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
const SUBMENU_DELAY_MS = 120;

function ContextMenu({ items, pos }: { items: ContextMenuEntry[]; pos: Position }) {
  const ref = useRef<HTMLDivElement>(null);
  const [resolvedPos, setResolvedPos] = useState<Position>(pos);
  const [openSub, setOpenSub] = useState<{ index: number; rect: DOMRect } | null>(null);
  const hoverTimer = useRef<number | null>(null);

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

  const scheduleOpenSub = (index: number, target: HTMLElement) => {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      setOpenSub({ index, rect: target.getBoundingClientRect() });
    }, SUBMENU_DELAY_MS);
  };
  const cancelOpenSub = () => {
    if (hoverTimer.current != null) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null; }
  };

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
          const hasSub = !!entry.submenu && entry.submenu.length > 0;
          return (
            <button
              key={i}
              role="menuitem"
              disabled={entry.disabled}
              title={entry.disabled ? entry.title : undefined}
              onMouseEnter={(e) => hasSub && !entry.disabled ? scheduleOpenSub(i, e.currentTarget) : (cancelOpenSub(), setOpenSub(null))}
              onMouseLeave={cancelOpenSub}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (hasSub) return; // hovering opens submenu; click is no-op
                entry.onClick?.();
                closeContextMenu();
              }}
              className={`w-full flex items-center justify-between gap-3 px-2.5 py-1.5 text-[13px] text-left transition-colors mx-1 rounded
                ${entry.disabled
                  ? 'text-fg-dim cursor-not-allowed'
                  : entry.danger
                    ? 'text-danger hover:bg-danger hover:text-white'
                    : 'text-fg hover:bg-accent hover:text-white'}`}
              style={{ width: 'calc(100% - 8px)' }}
            >
              <span className="truncate">{entry.label}</span>
              <span className="shrink-0 flex items-center gap-1">
                {entry.icon && <span className="opacity-80">{entry.icon}</span>}
                {hasSub && <span aria-hidden className="text-fg-dim">▸</span>}
              </span>
            </button>
          );
        })}
      </div>
      {openSub && (() => {
        const entry = items[openSub.index];
        if (!entry || entry.type !== 'item' || !entry.submenu) return null;
        // Position to the right of the parent item, falling back to the left.
        const x = openSub.rect.right + 2;
        const y = openSub.rect.top;
        return createPortal(<Submenu items={entry.submenu} pos={{ x, y }} fallbackLeft={openSub.rect.left} />, document.body);
      })()}
    </>
  );
}

function Submenu({ items, pos, fallbackLeft }: { items: ContextMenuEntry[]; pos: Position; fallbackLeft: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [resolvedPos, setResolvedPos] = useState<Position>(pos);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let { x, y } = pos;
    if (x + rect.width + margin > window.innerWidth) x = Math.max(margin, fallbackLeft - rect.width - 2);
    if (y + rect.height + margin > window.innerHeight) y = Math.max(margin, window.innerHeight - rect.height - margin);
    setResolvedPos({ x, y });
  }, [pos, items, fallbackLeft]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[62] min-w-[200px] py-1.5 border border-white/[0.08] rounded-md shadow-2xl animate-pop-in origin-top-left max-h-[60vh] overflow-y-auto"
      style={{ left: resolvedPos.x, top: resolvedPos.y, minWidth: MIN_W, backgroundColor: '#28282d' }}
    >
      {items.map((entry, i) => {
        if (entry.type === 'separator') return <div key={i} className="my-1 mx-2 border-t border-white/[0.06]" />;
        return (
          <button
            key={i}
            role="menuitem"
            disabled={entry.disabled}
            title={entry.disabled ? entry.title : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { entry.onClick?.(); closeContextMenu(); }}
            className={`w-full flex items-center justify-between gap-3 px-2.5 py-1.5 text-[13px] text-left transition-colors mx-1 rounded
              ${entry.disabled
                ? 'text-fg-dim cursor-not-allowed'
                : entry.danger
                  ? 'text-danger hover:bg-danger hover:text-white'
                  : 'text-fg hover:bg-accent hover:text-white'}`}
            style={{ width: 'calc(100% - 8px)' }}
          >
            <span className="truncate flex items-center gap-2">{entry.icon && <span className="opacity-80">{entry.icon}</span>}{entry.label}</span>
          </button>
        );
      })}
    </div>
  );
}
