import type { ReactNode } from 'react';

export function Field({
  label, hint, children, htmlFor,
}: {
  label?: string | undefined;
  hint?: ReactNode | undefined;
  htmlFor?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={htmlFor}
          className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-dim"
        >
          {label}
        </label>
      )}
      {children}
      {hint && <div className="text-[11px] text-fg-dim leading-relaxed">{hint}</div>}
    </div>
  );
}
