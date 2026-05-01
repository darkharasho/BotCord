import { useId, useState, type ReactNode } from 'react';
import { IconEye, IconEyeOff } from '@tabler/icons-react';
import { Field } from './Field';

type Props = {
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'password' | 'email' | 'url';
  label?: string;
  hint?: ReactNode;
  placeholder?: string;
  leadingIcon?: ReactNode;
  trailing?: ReactNode;
  monospace?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
};

export function TextField({
  value, onChange, type = 'text', label, hint, placeholder, leadingIcon, trailing, monospace, disabled, autoFocus, onBlur,
}: Props) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  const effectiveType = isPassword && revealed ? 'text' : type;

  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="group relative flex items-center rounded-md border border-border bg-bg-sunken focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-colors">
        {leadingIcon && (
          <span className="pl-3 text-fg-dim group-focus-within:text-fg-muted shrink-0 flex items-center">
            {leadingIcon}
          </span>
        )}
        <input
          id={id}
          type={effectiveType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          className={`flex-1 min-w-0 bg-transparent px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-dim disabled:opacity-50 disabled:cursor-not-allowed ${monospace ? 'font-mono' : ''} ${leadingIcon ? 'pl-2' : ''}`}
        />
        {isPassword && value.length > 0 && (
          <button
            type="button"
            onClick={() => setRevealed(r => !r)}
            aria-label={revealed ? 'Hide value' : 'Reveal value'}
            className="px-2.5 text-fg-dim hover:text-fg shrink-0"
          >
            {revealed ? <IconEyeOff size={15} stroke={2} /> : <IconEye size={15} stroke={2} />}
          </button>
        )}
        {trailing && <div className="pr-2 shrink-0 flex items-center">{trailing}</div>}
      </div>
    </Field>
  );
}
