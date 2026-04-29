import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
};

export function ColumnFilterPopover({ anchor, onClose, children }: Props) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchor) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }

    function handleMouseDown(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !anchor!.contains(e.target as Node)
      ) {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [anchor, onClose]);

  if (!anchor) return null;

  const rect = anchor.getBoundingClientRect();
  const style: React.CSSProperties = {
    position: 'fixed',
    top: rect.bottom + 4,
    left: rect.left,
    zIndex: 9999,
    width: 240,
  };

  return createPortal(
    <div
      ref={popoverRef}
      style={style}
      className="bg-[#28282d] border border-white/[0.08] rounded-lg shadow-xl p-3 flex flex-col gap-2 text-[13px] text-fg"
    >
      {children}
    </div>,
    document.body,
  );
}
