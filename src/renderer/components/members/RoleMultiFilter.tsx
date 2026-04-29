import type { GuildRole } from '../../../shared/domain';

function CheckBoxSmall({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={e => { e.stopPropagation(); onChange(); }}
      className={`relative inline-flex items-center justify-center w-[18px] h-[18px] rounded-[4px] border transition-colors shrink-0 ${
        checked ? 'bg-accent border-accent' : 'bg-transparent border-white/30 hover:border-white/60'
      }`}
    >
      {checked && (
        <svg viewBox="0 0 16 16" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 8 7 12 13 4" />
        </svg>
      )}
    </button>
  );
}

type Props = {
  roles: GuildRole[];
  selected: Set<string>;
  onToggle: (roleId: string) => void;
  onClear: () => void;
};

export function RoleMultiFilter({ roles, selected, onToggle, onClear }: Props) {
  const assignable = roles.filter(r => !r.managed);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-fg-dim uppercase tracking-wide">Filter by roles (all must match)</div>
      <div className="flex flex-col gap-0.5 max-h-[200px] overflow-y-auto">
        {assignable.length === 0 && (
          <div className="text-[12px] text-fg-dim py-1">No assignable roles</div>
        )}
        {assignable.map(r => {
          const isSelected = selected.has(r.id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onToggle(r.id)}
              className="flex items-center gap-2 px-1 py-1 rounded hover:bg-white/[0.05] text-left w-full"
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: r.color ?? 'rgba(255,255,255,0.2)' }}
              />
              <span className="flex-1 min-w-0 truncate text-[12px]" style={r.color ? { color: r.color } : undefined}>
                {r.name}
              </span>
              <CheckBoxSmall checked={isSelected} onChange={() => onToggle(r.id)} />
            </button>
          );
        })}
      </div>
      {selected.size > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] text-fg-dim hover:text-fg underline text-left"
        >
          Clear ({selected.size} selected)
        </button>
      )}
    </div>
  );
}
