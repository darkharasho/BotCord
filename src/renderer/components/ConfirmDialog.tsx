import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onMouseDown={onCancel}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className="w-[440px] max-w-[90vw] rounded-md border border-white/[0.08] shadow-2xl"
        style={{ backgroundColor: '#28282d' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-2 text-fg text-[16px] font-semibold">{title}</div>
        {description && <div className="px-5 pb-2 text-fg-dim text-[13px]">{description}</div>}
        <div className="px-5 py-3 space-y-3">{children}</div>
        <div className="px-5 py-3 flex justify-end gap-2 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-1.5 rounded text-[13px] text-fg hover:bg-hover disabled:opacity-50"
          >Cancel</button>
          <button
            type="button"
            data-autofocus
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-1.5 rounded text-[13px] text-white disabled:opacity-50 ${danger ? 'bg-danger hover:bg-danger/80' : 'bg-accent hover:bg-accent/80'}`}
          >{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
