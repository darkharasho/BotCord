import { useId, type ReactNode } from 'react';
import { IconMinus, IconPlus } from '@tabler/icons-react';
import { Field } from './Field';

type Props = {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  hint?: ReactNode;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
};

export function NumberField({
  value, onChange, label, hint, min, max, step = 1, unit, disabled,
}: Props) {
  const id = useId();

  const clamp = (n: number) => {
    if (Number.isNaN(n)) return min ?? 0;
    if (typeof min === 'number' && n < min) return min;
    if (typeof max === 'number' && n > max) return max;
    return n;
  };

  const adjust = (delta: number) => onChange(clamp(value + delta));

  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="inline-flex items-stretch rounded-md border border-border bg-bg-sunken focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-colors">
        <button
          type="button"
          onClick={() => adjust(-step)}
          disabled={disabled || (typeof min === 'number' && value <= min)}
          aria-label="Decrease"
          className="px-2 text-fg-dim hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed border-r border-border"
        >
          <IconMinus size={14} stroke={2} />
        </button>
        <input
          id={id}
          type="number"
          value={value}
          onChange={(e) => onChange(clamp(parseFloat(e.target.value)))}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className="w-20 bg-transparent text-center px-1 py-1.5 text-sm text-fg font-mono tabular-nums outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {unit && (
          <span className="flex items-center pr-2 text-[11px] uppercase tracking-wider text-fg-dim">
            {unit}
          </span>
        )}
        <button
          type="button"
          onClick={() => adjust(step)}
          disabled={disabled || (typeof max === 'number' && value >= max)}
          aria-label="Increase"
          className="px-2 text-fg-dim hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed border-l border-border"
        >
          <IconPlus size={14} stroke={2} />
        </button>
      </div>
    </Field>
  );
}
