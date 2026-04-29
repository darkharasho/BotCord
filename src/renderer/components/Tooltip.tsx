import { useState, type ReactNode, type CSSProperties } from 'react';

type Props = {
  label: string;
  side?: 'right' | 'top' | 'bottom';
  children: ReactNode;
};

export function Tooltip({ label, side = 'right', children }: Props) {
  const [show, setShow] = useState(false);
  // The position class places the tooltip; the animation slides it in from
  // a small offset toward its resting transform. Because the tooltip's
  // resting position relies on a centering translate (e.g. translateY(-50%)),
  // we drive the entrance transforms via CSS variables so the animation
  // doesn't clobber that resting state.
  const layout = side === 'right'
    ? { className: 'left-full ml-2 top-1/2',
        from: 'translate(-2px, -50%)',
        to:   'translate(0, -50%)' }
    : side === 'top'
    ? { className: 'bottom-full mb-2 left-1/2',
        from: 'translate(-50%, 2px)',
        to:   'translate(-50%, 0)' }
    : { className: 'top-full mt-2 left-1/2',
        from: 'translate(-50%, -2px)',
        to:   'translate(-50%, 0)' };

  const animationStyle: CSSProperties = {
    ['--bc-tooltip-from' as string]: layout.from,
    ['--bc-tooltip-to' as string]: layout.to,
    transform: layout.to,
  };

  return (
    <div className="relative inline-block" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div
          className={`absolute ${layout.className} bc-tooltip z-50 px-2 py-1 rounded bg-bg-sunken border border-border text-xs text-fg whitespace-nowrap shadow-lg pointer-events-none`}
          style={animationStyle}
        >
          {label}
        </div>
      )}
    </div>
  );
}
