import { useEffect, useState } from 'react';

type Toast = { id: number; kind: 'info' | 'ok' | 'warn' | 'danger'; text: string };
const listeners = new Set<(t: Toast) => void>();
let nextId = 1;

export function pushToast(kind: Toast['kind'], text: string): void {
  const t: Toast = { id: nextId++, kind, text };
  for (const cb of listeners) cb(t);
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (t: Toast) => {
      setToasts(prev => [...prev, t]);
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 4000);
    };
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  return (
    <div className="fixed bottom-4 right-4 space-y-2 z-50">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`px-3 py-2 rounded text-sm border shadow-lg max-w-sm ${
            t.kind === 'ok' ? 'bg-ok/10 border-ok/40 text-ok' :
            t.kind === 'warn' ? 'bg-warn/10 border-warn/40 text-warn' :
            t.kind === 'danger' ? 'bg-danger/10 border-danger/40 text-danger' :
            'bg-bg-subtle border-border text-fg'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
