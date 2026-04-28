import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { GatewayState } from '../../shared/domain';
import { pushToast } from './Toaster';

const COLORS: Record<GatewayState['status'], string> = {
  ready: 'bg-ok',
  connecting: 'bg-warn',
  reconnecting: 'bg-warn',
  disconnected: 'bg-danger',
};

const LABELS: Record<GatewayState['status'], (s: GatewayState) => string> = {
  ready: () => 'Connected',
  connecting: () => 'Connecting…',
  reconnecting: (s) => s.status === 'reconnecting' ? `Reconnecting (attempt ${s.attempt})` : 'Reconnecting',
  disconnected: () => 'Disconnected',
};

const TOAST_FOR: Partial<Record<GatewayState['status'], { kind: 'ok' | 'warn' | 'danger'; text: string }>> = {
  ready: { kind: 'ok', text: 'Bot connected' },
  reconnecting: { kind: 'warn', text: 'Reconnecting to Discord…' },
  disconnected: { kind: 'danger', text: 'Disconnected from Discord' },
};

export function StatusPill() {
  const [state, setState] = useState<GatewayState>({ status: 'connecting' });
  const prev = useRef<GatewayState['status'] | null>(null);

  useEffect(() => {
    api.bot.getStatus().then(s => {
      if (s.kind === 'configured') setState(s.gateway);
    });
    return api.events.onGatewayState(setState);
  }, []);

  useEffect(() => {
    if (prev.current !== null && prev.current !== state.status) {
      const t = TOAST_FOR[state.status];
      if (t) pushToast(t.kind, t.text);
    }
    prev.current = state.status;
  }, [state.status]);

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`inline-block w-2 h-2 rounded-full ${COLORS[state.status]}`} />
      <span className="text-fg-muted">{LABELS[state.status](state)}</span>
    </div>
  );
}
