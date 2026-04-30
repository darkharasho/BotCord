export function CheckBox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const filled = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={`relative inline-flex items-center justify-center w-[18px] h-[18px] rounded-[4px] border transition-colors shrink-0 ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : filled
            ? (indeterminate ? 'bg-accent/40 border-accent' : 'bg-accent border-accent')
            : 'bg-transparent border-white/30 hover:border-white/60'
      }`}
    >
      {checked && !indeterminate && (
        <svg viewBox="0 0 16 16" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 8 7 12 13 4" />
        </svg>
      )}
      {indeterminate && (
        <span className="block w-2.5 h-[2px] bg-white rounded-full" />
      )}
    </button>
  );
}
