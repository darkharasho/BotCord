import type { ReactNode } from 'react';

export function CategoryGroup({
  name, collapsed, onToggle, children,
}: { name: string; collapsed: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="mt-3">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted hover:text-fg"
      >
        <span className={`inline-block transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
        <span className="truncate">{name}</span>
      </button>
      {!collapsed && <div className="mt-1 space-y-0.5">{children}</div>}
    </div>
  );
}
