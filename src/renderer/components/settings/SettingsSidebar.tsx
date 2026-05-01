import { NAV_GROUPS, type SectionId } from './types';

export function SettingsSidebar({
  active, onSelect, onResetToken,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  onResetToken: () => void;
}) {
  return (
    <nav className="w-60 shrink-0 h-full bg-bg-sunken border-r border-border flex flex-col">
      <div className="flex-1 overflow-y-auto py-6 px-3">
        {NAV_GROUPS.map(group => (
          <div key={group.label} className="mb-6">
            <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
              {group.label}
            </div>
            <ul>
              {group.items.map(item => (
                <li key={item.id}>
                  <button
                    onClick={() => onSelect(item.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                      active === item.id
                        ? 'bg-accent text-white'
                        : 'text-fg hover:bg-hover'
                    }`}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-3">
        <button
          onClick={onResetToken}
          className="w-full px-3 py-2 rounded border border-danger/50 text-danger text-sm hover:bg-danger/10"
        >
          Reset Bot Token
        </button>
      </div>
    </nav>
  );
}
