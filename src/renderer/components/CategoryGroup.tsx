import type { ReactNode } from 'react';

export function CategoryGroup({
  name, collapsed, onToggle, children,
}: { name: string; collapsed: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="mt-4 first:mt-2">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-0.5 pl-0.5 pr-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-fg-dim hover:text-fg-muted"
      >
        <span className={`inline-block w-3 text-[8px] transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
        <span className="truncate">{name}</span>
      </button>
      {!collapsed && <div className="mt-0.5 space-y-px">{children}</div>}
    </div>
  );
}
