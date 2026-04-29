import { useEffect, useState } from 'react';
import { api } from '../lib/api';

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
      {/* Left padding reserves room for macOS traffic lights */}
      <div className={`${isMac ? 'w-20' : 'w-3'} shrink-0`} />
      <img src="./botcord-white.svg" alt="" className="w-4 h-4 mr-1.5" />
      <span className="font-medium tracking-tight text-fg">BotCord</span>
      <div className="flex-1" />
      {!isMac && (
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
