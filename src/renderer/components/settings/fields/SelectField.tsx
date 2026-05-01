import { useId, type ReactNode } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { Field } from './Field';

type Option = { value: string; label: string };

type Props = {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  label?: string;
  hint?: ReactNode;
  disabled?: boolean;
};

export function SelectField({
  value, onChange, options, label, hint, disabled,
}: Props) {
  const id = useId();

  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="relative inline-flex w-full max-w-sm items-stretch rounded-md border border-border bg-bg-sunken focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-colors">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="appearance-none w-full bg-transparent pl-3 pr-9 py-2 text-sm text-fg outline-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {options.map(o => (
            <option key={o.value} value={o.value} className="bg-bg-input text-fg">
              {o.label}
            </option>
          ))}
        </select>
        <IconChevronDown
          size={14}
          stroke={2}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-dim pointer-events-none"
        />
      </div>
    </Field>
  );
}
