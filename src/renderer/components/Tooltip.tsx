import { useState, type ReactNode } from 'react';

type Props = {
  label: string;
  side?: 'right' | 'top' | 'bottom';
  children: ReactNode;
};

export function Tooltip({ label, side = 'right', children }: Props) {
  const [show, setShow] = useState(false);
  const pos =
    side === 'right' ? 'left-full ml-2 top-1/2 -translate-y-1/2' :
    side === 'top'   ? 'bottom-full mb-2 left-1/2 -translate-x-1/2' :
                       'top-full mt-2 left-1/2 -translate-x-1/2';
  return (
    <div className="relative inline-block" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className={`absolute ${pos} z-50 px-2 py-1 rounded bg-bg-sunken border border-border text-xs text-fg whitespace-nowrap shadow-lg pointer-events-none`}>
          {label}
        </div>
      )}
    </div>
  );
}
