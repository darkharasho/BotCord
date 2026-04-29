import { useCallback, useEffect, useId, useState } from 'react';

// Module-level registry: at most one popover may be "active" across the app.
// Each consumer registers a close callback keyed by id; opening any popover
// invokes every other registered callback. Mirrors the listeners pattern
// already used by Lightbox.
const closers = new Map<string, () => void>();
let activeId: string | null = null;

function broadcastOpen(id: string): void {
  if (activeId === id) return;
  for (const [otherId, close] of closers) {
    if (otherId !== id) close();
  }
  activeId = id;
}

function broadcastClose(id: string): void {
  if (activeId === id) activeId = null;
}

// Returns [open, setOpen] where opening this popover closes every other one
// using this hook. If the consumer unmounts while open, it deregisters first.
export function useExclusivePopover(): [boolean, (next: boolean) => void] {
  const id = useId();
  const [open, setOpenLocal] = useState(false);

  useEffect(() => {
    closers.set(id, () => setOpenLocal(false));
    return () => {
      closers.delete(id);
      broadcastClose(id);
    };
  }, [id]);

  const setOpen = useCallback((next: boolean) => {
    setOpenLocal(next);
    if (next) broadcastOpen(id);
    else broadcastClose(id);
  }, [id]);

  return [open, setOpen];
}
