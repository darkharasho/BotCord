import { IconLogout } from '@tabler/icons-react';
import { NAV_GROUPS, type SectionId } from './types';

export function SettingsSidebar({
  active, onSelect, onResetToken,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  onResetToken: () => void;
}) {
  return (
    <nav className="w-64 shrink-0 h-full bg-bg-sunken border-r border-border flex flex-col">
      <div className="px-5 pt-6 pb-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-dim">
          Settings
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map(group => (
          <div key={group.label} className="mb-5">
            <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-dim">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map(item => {
                const Icon = item.icon;
                const isActive = active === item.id;
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => onSelect(item.id)}
                      className={`group relative w-full flex items-center gap-2.5 pl-4 pr-3 py-1.5 rounded-md text-sm transition-all duration-150 ${
                        isActive
                          ? 'bg-selected text-fg'
                          : 'text-fg-muted hover:bg-hover hover:text-fg'
                      }`}
                    >
                      <span
                        className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-accent transition-all duration-200 ${
                          isActive ? 'h-5 opacity-100' : 'h-0 opacity-0 group-hover:h-3 group-hover:opacity-50'
                        }`}
                      />
                      <Icon
                        size={16}
                        stroke={2}
                        className={`shrink-0 transition-colors ${isActive ? 'text-accent' : ''}`}
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-3">
        <button
          onClick={onResetToken}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-danger/40 text-danger text-sm font-medium hover:bg-danger/10 hover:border-danger/60 transition-colors"
        >
          <IconLogout size={16} stroke={2} className="shrink-0" />
          Reset Bot Token
        </button>
      </div>
    </nav>
  );
}
