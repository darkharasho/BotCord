import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { BotIdentity } from '../../shared/domain';
import { IconSparkles } from '@tabler/icons-react';

export function AutonomyThinkingIndicator({ channelId }: { channelId: string | null }) {
  const [thinking, setThinking] = useState(false);
  const [identity, setIdentity] = useState<BotIdentity | null>(null);

  useEffect(() => {
    api.bot.getStatus().then(s => { if (s.kind === 'configured') setIdentity(s.identity); });
    return api.events.onBotStatus(s => { if (s.kind === 'configured') setIdentity(s.identity); });
  }, []);

  useEffect(() => {
    if (!channelId) { setThinking(false); return; }
    setThinking(false);
    const offStart = api.events.onAutonomyThinkingStart(p => {
      if (p.channelId === channelId) setThinking(true);
    });
    const offEnd = api.events.onAutonomyThinkingEnd(p => {
      if (p.channelId === channelId) setThinking(false);
    });
    return () => { offStart(); offEnd(); };
  }, [channelId]);

  if (!thinking) return null;

  const name = identity?.username ?? 'Bot';

  return (
    <div className="px-4 py-1.5 flex items-center gap-2 text-[13px] text-fg-muted shrink-0">
      {identity?.avatarUrl
        ? <img src={identity.avatarUrl} alt="" className="w-5 h-5 rounded-full shrink-0" />
        : <div className="w-5 h-5 rounded-full bg-bg-input shrink-0" />}
      <IconSparkles size={14} stroke={1.75} className="text-accent shrink-0" />
      <span><span className="font-medium text-fg">{name}</span> is thinking</span>
      <span className="inline-flex gap-0.5 items-center">
        <span className="w-1 h-1 rounded-full bg-fg-muted animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1 h-1 rounded-full bg-fg-muted animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1 h-1 rounded-full bg-fg-muted animate-bounce" />
      </span>
    </div>
  );
}
