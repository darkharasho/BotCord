type Props = {
  from: number | null;
  to: number | null;
  onFrom: (v: number | null) => void;
  onTo: (v: number | null) => void;
  onClose: () => void;
};

function msToDateInput(ms: number | null): string {
  if (ms == null) return '';
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateInputToMs(val: string): number | null {
  if (!val) return null;
  const ms = new Date(val).getTime();
  return isNaN(ms) ? null : ms;
}

export function DateRangeFilter({ from, to, onFrom, onTo, onClose }: Props) {
  const hasFilter = from != null || to != null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-fg-dim uppercase tracking-wide">From</label>
        <input
          type="date"
          value={msToDateInput(from)}
          onChange={e => onFrom(dateInputToMs(e.target.value))}
          className="bg-bg-input border border-white/[0.08] rounded px-2 py-1 text-[12px] text-fg w-full"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-fg-dim uppercase tracking-wide">To</label>
        <input
          type="date"
          value={msToDateInput(to)}
          onChange={e => onTo(dateInputToMs(e.target.value))}
          className="bg-bg-input border border-white/[0.08] rounded px-2 py-1 text-[12px] text-fg w-full"
        />
      </div>
      <div className="flex items-center justify-between pt-1">
        {hasFilter ? (
          <button
            type="button"
            onClick={() => { onFrom(null); onTo(null); }}
            className="text-[11px] text-fg-dim hover:text-fg underline"
          >
            Clear
          </button>
        ) : <span />}
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] bg-accent hover:bg-accent/80 text-white px-2 py-0.5 rounded"
        >
          Done
        </button>
      </div>
    </div>
  );
}
