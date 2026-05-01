import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { IconCheck, IconLoader2 } from '@tabler/icons-react';

type SaveState = 'idle' | 'saving' | 'saved';

type Ctx = {
  state: SaveState;
  /** Mark a save as in-flight. Pass a promise to track its completion;
   *  call without arguments for fire-and-forget (auto-flips to "saved"
   *  after a short delay). */
  trigger: (p?: Promise<unknown>) => void;
};

const SavingContext = createContext<Ctx | null>(null);

const SAVED_FOR_MS = 1200;
const FLUSH_AFTER_MS = 350;

export function SavingStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SaveState>('idle');
  const inflight = useRef(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSaved = useCallback(() => {
    setState('saved');
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setState('idle'), SAVED_FOR_MS);
  }, []);

  const trigger = useCallback((p?: Promise<unknown>) => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    inflight.current += 1;
    setState('saving');

    const finish = () => {
      inflight.current = Math.max(0, inflight.current - 1);
      if (inflight.current === 0) showSaved();
    };

    if (p && typeof p.then === 'function') {
      p.then(finish, finish);
    } else {
      // Fire-and-forget save (no promise to await). Hold "saving" briefly
      // so the indicator is actually visible, then flip to "saved".
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(finish, FLUSH_AFTER_MS);
    }
  }, [showSaved]);

  return (
    <SavingContext.Provider value={{ state, trigger }}>
      {children}
    </SavingContext.Provider>
  );
}

export function useSaver() {
  const ctx = useContext(SavingContext);
  if (!ctx) return { trigger: (_p?: Promise<unknown>) => { /* no-op outside settings */ } };
  return { trigger: ctx.trigger };
}

export function SavingIndicator() {
  const ctx = useContext(SavingContext);
  if (!ctx || ctx.state === 'idle') return null;
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-medium text-fg-muted animate-fade-in">
      {ctx.state === 'saving' ? (
        <>
          <IconLoader2 size={12} stroke={2.5} className="animate-spin text-accent" />
          <span>Saving…</span>
        </>
      ) : (
        <>
          <IconCheck size={12} stroke={2.5} className="text-ok" />
          <span>Saved</span>
        </>
      )}
    </div>
  );
}
