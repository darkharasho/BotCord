import { useId, type ReactNode } from 'react';
import { Field } from './Field';

type Props = {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  hint?: ReactNode;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  monospace?: boolean;
  onBlur?: () => void;
};

export function TextArea({
  value, onChange, label, hint, placeholder, rows = 5, disabled, monospace, onBlur,
}: Props) {
  const id = useId();

  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="rounded-md border border-border bg-bg focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-colors">
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className={`block w-full bg-transparent px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-dim resize-y disabled:opacity-50 disabled:cursor-not-allowed leading-relaxed ${monospace ? 'font-mono' : ''}`}
        />
      </div>
    </Field>
  );
}
