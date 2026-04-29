import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Logo } from './Logo';

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null);

  useEffect(() => {
    api.window.platform().then(setPlatform);
    api.window.isMaximized().then(setMaximized);
    return api.window.onMaximizeChange(setMaximized);
  }, []);

  const isMac = platform === 'darwin';

  return (
    <div
      className="h-7 shrink-0 flex items-center bg-bg-sunken text-fg-dim text-xs select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left spacer — matches right side width for centering */}
      {isMac
        ? <div className="w-20 shrink-0" />
        : <div className="w-[calc(3*2.75rem)] shrink-0" />}
      <div className="flex-1 flex items-center justify-center gap-2">
        <Logo className="h-3.5 w-auto text-fg" />
        <span className="font-medium tracking-tight text-fg">BotCord</span>
      </div>
      {!isMac ? (
        <div
          className="flex items-center h-full"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <WindowButton onClick={() => api.window.minimize()} title="Minimize">
            <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" /></svg>
          </WindowButton>
          <WindowButton onClick={() => api.window.toggleMaximize()} title={maximized ? 'Restore' : 'Maximize'}>
            {maximized
              ? (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                  <rect x="2.5" y="0.5" width="7" height="7" />
                  <rect x="0.5" y="2.5" width="7" height="7" fill="var(--tw-bg, #1e1f22)" />
                </svg>
              )
              : (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                  <rect x="0.5" y="0.5" width="9" height="9" />
                </svg>
              )}
          </WindowButton>
          <WindowButton onClick={() => api.window.close()} title="Close" danger>
            <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1" /><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1" /></svg>
          </WindowButton>
        </div>
      ) : (
        <div className="w-20 shrink-0" />
      )}
    </div>
  );
}

function WindowButton({ onClick, title, danger, children }: { onClick: () => void; title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-11 h-7 flex items-center justify-center hover:text-fg ${danger ? 'hover:bg-danger hover:text-white' : 'hover:bg-hover'}`}
    >
      {children}
    </button>
  );
}
