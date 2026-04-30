type Listener = (action: ComposerBusAction) => void;

export type ComposerBusAction =
  | { kind: 'append'; channelId: string; text: string }
  | { kind: 'replace'; channelId: string; text: string }
  | { kind: 'clear'; channelId: string }
  | { kind: 'generatingStart'; channelId: string }
  | { kind: 'generatingEnd'; channelId: string }
  | { kind: 'setReplyTarget'; channelId: string; messageId: string; authorDisplayName: string };

const listeners = new Set<Listener>();

export function subscribeComposerBus(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function emitComposerBus(action: ComposerBusAction): void {
  for (const l of listeners) l(action);
}
