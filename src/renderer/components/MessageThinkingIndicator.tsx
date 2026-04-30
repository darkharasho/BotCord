import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { BotIdentity } from '../../shared/domain';
import { IconSparkles } from '@tabler/icons-react';

let cachedIdentity: BotIdentity | null = null;

/**
 * Small inline "<bot> is thinking" row, attached directly under the
 * message that triggered an autonomous response. Rendered by MessageGroup
 * for any message whose id is in the per-channel autonomy-thinking set.
 */
export function MessageThinkingIndicator() {
  const [identity, setIdentity] = useState<BotIdentity | null>(cachedIdentity);

  useEffect(() => {
    if (!cachedIdentity) {
      api.bot.getStatus().then(s => {
        if (s.kind === 'configured') { cachedIdentity = s.identity; setIdentity(s.identity); }
      });
    }
    return api.events.onBotStatus(s => {
      if (s.kind === 'configured') { cachedIdentity = s.identity; setIdentity(s.identity); }
    });
  }, []);

  const name = identity?.username ?? 'Bot';

  return (
    <div className="flex items-center gap-2 -mx-4 px-4 py-1 text-[12px] text-fg-muted bg-accent/[0.04]">
      <div className="w-10 shrink-0 flex justify-end pr-1">
        {identity?.avatarUrl
          ? <img src={identity.avatarUrl} alt="" className="w-4 h-4 rounded-full shrink-0" />
          : <div className="w-4 h-4 rounded-full bg-bg-input shrink-0" />}
      </div>
      <IconSparkles size={12} stroke={1.75} className="text-accent shrink-0" />
      <span><span className="font-medium text-fg">{name}</span> is thinking</span>
      <span className="inline-flex gap-0.5 items-center">
        <span className="w-1 h-1 rounded-full bg-fg-muted animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1 h-1 rounded-full bg-fg-muted animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1 h-1 rounded-full bg-fg-muted animate-bounce" />
      </span>
    </div>
  );
}
