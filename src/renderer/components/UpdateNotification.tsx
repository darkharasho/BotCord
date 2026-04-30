import { useEffect, useState } from 'react';
import { IconRefresh, IconDownload, IconCircleCheck, IconX } from '@tabler/icons-react';
import { api } from '../lib/api';

type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

type UpdateState = {
  phase: UpdatePhase;
  version: string | null;
  percent: number;
  errorMessage: string | null;
};

// Discord-y pill that floats in the title bar / top-right area while an
// auto-update is in flight. Mirrors sai's UpdateNotification but rebuilt
// against BotCord's tailwind tokens. The main process drives all state
// transitions through `update:*` IPC events.
export function UpdateNotification() {
  const [state, setState] = useState<UpdateState>({
    phase: 'idle',
    version: null,
    percent: 0,
    errorMessage: null,
  });
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const cleanups: Array<() => void> = [];

    cleanups.push(api.update.onStatus((status) => {
      if (status === 'checking') {
        setState(prev => ({ ...prev, phase: 'checking', errorMessage: null }));
        setDismissed(false);
        setVisible(true);
      } else if (status === 'up-to-date') {
        setTimeout(() => setVisible(false), 2000);
      }
    }));

    cleanups.push(api.update.onAvailable((info) => {
      setState(prev => ({ ...prev, phase: 'downloading', version: info.version, percent: 0 }));
      setDismissed(false);
      setVisible(true);
    }));

    cleanups.push(api.update.onProgress((progress) => {
      setState(prev => ({ ...prev, phase: 'downloading', percent: Math.round(progress.percent) }));
    }));

    cleanups.push(api.update.onDownloaded((info) => {
      setState(prev => ({ ...prev, phase: 'ready', version: info.version, percent: 100 }));
    }));

    cleanups.push(api.update.onError((err) => {
      setState(prev => ({ ...prev, phase: 'error', errorMessage: err.message }));
      setTimeout(() => setVisible(false), 8000);
    }));

    return () => cleanups.forEach(fn => fn());
  }, []);

  if (!visible || dismissed) return null;

  const { phase, version, percent } = state;

  const baseClass = 'flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[11px] font-medium border whitespace-nowrap animate-fade-in-down';

  if (phase === 'checking') {
    return (
      <div className={`${baseClass} text-fg-muted border-white/[0.08] bg-bg-subtle`}>
        <IconRefresh size={11} stroke={2} className="animate-[spin_1s_linear_infinite]" />
        <span>Checking for updates…</span>
      </div>
    );
  }

  if (phase === 'downloading') {
    return (
      <div className={`${baseClass} text-warn border-warn/30 bg-warn/10`}>
        <IconDownload size={11} stroke={2} />
        <span>Updating{version ? ` to v${version}` : ''}…</span>
        <div className="w-12 h-1 bg-warn/20 rounded overflow-hidden">
          <div className="h-full bg-warn transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
        <span className="font-mono text-[10px] min-w-[28px] text-right">{percent}%</span>
      </div>
    );
  }

  if (phase === 'ready') {
    return (
      <div className={`${baseClass} text-ok border-ok/30 bg-ok/10`}>
        <IconCircleCheck size={11} stroke={2} />
        <span>v{version} ready</span>
        <button
          onClick={() => api.update.install()}
          className="bg-ok text-black rounded px-2 py-px text-[10px] font-bold hover:brightness-110"
        >
          Restart now
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-ok/70 hover:text-ok p-0.5 rounded hover:bg-white/10"
          aria-label="Dismiss"
        >
          <IconX size={10} stroke={2} />
        </button>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={`${baseClass} text-danger border-danger/30 bg-danger/10`}>
        <span>Update failed</span>
        <button
          onClick={() => setDismissed(true)}
          className="text-danger/70 hover:text-danger p-0.5 rounded hover:bg-white/10"
          aria-label="Dismiss"
        >
          <IconX size={10} stroke={2} />
        </button>
      </div>
    );
  }

  return null;
}
