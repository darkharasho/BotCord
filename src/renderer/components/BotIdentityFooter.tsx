import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { BotIdentity, GatewayState } from '../../shared/domain';
import { IconSettings, IconSparkles } from '@tabler/icons-react';
import { Tooltip } from './Tooltip';
import { useGlobalAutonomy } from '../lib/use-global-autonomy';

const DOT_COLORS: Record<GatewayState['status'], string> = {
  ready: 'bg-ok',
  connecting: 'bg-warn',
  reconnecting: 'bg-warn',
  disconnected: 'bg-danger',
};

const STATUS_LABEL: Record<GatewayState['status'], string> = {
  ready: 'Online',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  disconnected: 'Offline',
};

export function BotIdentityFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [identity, setIdentity] = useState<BotIdentity | null>(null);
  const [gateway, setGateway] = useState<GatewayState>({ status: 'connecting' });

  useEffect(() => {
    api.bot.getStatus().then(s => {
      if (s.kind === 'configured') { setIdentity(s.identity); setGateway(s.gateway); }
    });
    const unsubStatus = api.events.onBotStatus(s => {
      if (s.kind === 'configured') { setIdentity(s.identity); setGateway(s.gateway); }
    });
    const unsubGw = api.events.onGatewayState(setGateway);
    return () => { unsubStatus(); unsubGw(); };
  }, []);

  const dot = DOT_COLORS[gateway.status];
  const statusLabel = STATUS_LABEL[gateway.status];
  const { cfg: autonomy, set: setAutonomy } = useGlobalAutonomy();
  const autonomyOn = autonomy?.enabled ?? false;

  return (
    <div className="h-[52px] px-2 flex items-center gap-2 bg-bg-sunken shrink-0">
      <div className="relative shrink-0">
        {identity?.avatarUrl
          ? <img src={identity.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
          : <div className="w-8 h-8 rounded-full bg-bg-input flex items-center justify-center text-[11px] font-semibold text-fg">
              {(identity?.username ?? '??').slice(0, 2).toUpperCase()}
            </div>}
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ${dot} ring-[3px] ring-bg-sunken`}
        />
      </div>
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-[14px] font-semibold text-fg truncate">{identity?.username ?? '—'}</div>
        <div className="text-[11px] text-fg-dim truncate">{statusLabel}</div>
      </div>
      <Tooltip label={autonomyOn ? 'Autonomy on' : 'Autonomy off'} side="top">
        <button
          onClick={() => { void setAutonomy({ enabled: !autonomyOn }); }}
          aria-pressed={autonomyOn}
          disabled={!autonomy}
          className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
            autonomyOn
              ? 'text-accent hover:text-accent-hover hover:bg-hover'
              : 'text-fg-muted hover:text-fg hover:bg-hover'
          }`}
        >
          <IconSparkles size={20} stroke={1.75} />
        </button>
      </Tooltip>
      <Tooltip label="Settings" side="top">
        <button
          onClick={onOpenSettings}
          className="w-8 h-8 flex items-center justify-center rounded text-fg-muted hover:text-fg hover:bg-hover"
        >
          <IconSettings size={20} stroke={1.75} />
        </button>
      </Tooltip>
    </div>
  );
}
