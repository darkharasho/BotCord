import { useEffect, useState } from 'react';
import { ServerRail } from '../../components/ServerRail';
import { ChannelList } from '../../components/ChannelList';
import { BotIdentityFooter } from '../../components/BotIdentityFooter';
import { SettingsPanel } from '../../components/SettingsPanel';
import { Toaster } from '../../components/Toaster';
import { ChannelView } from './ChannelView';
import { api } from '../../lib/api';
import { useUnreads } from '../../lib/use-unreads';
import type { ChannelSummary, GuildSummary } from '../../../shared/domain';
import { IconChevronDown } from '@tabler/icons-react';

export function ShellRoute() {
  const [guild, setGuild] = useState<GuildSummary | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!guild) { setChannels([]); return; }
    api.guilds.listChannels(guild.id).then(res => { if (res.ok) setChannels(res.data); });
  }, [guild]);

  const channelName = channels.find(c => c.id === channelId)?.name ?? null;
  const unreads = useUnreads(channelId);

  return (
    <div className="h-full flex bg-bg-sunken">
      <aside className="w-[72px] shrink-0 min-h-0">
        <ServerRail
          selected={guild?.id ?? null}
          onSelect={(g) => { setGuild(g); setChannelId(null); }}
          unreadGuildIds={unreads.guildIds}
        />
      </aside>
      <aside className="w-60 shrink-0 min-h-0 bg-bg-sunken flex flex-col rounded-tl-xl border-t border-l border-white/[0.04] overflow-hidden">
        <div className="h-12 px-4 flex items-center justify-between shadow-[0_1px_0_rgba(0,0,0,0.2),0_1.5px_0_rgba(0,0,0,0.05),0_2px_0_rgba(0,0,0,0.05)] z-10 shrink-0">
          <span className="font-semibold text-fg text-[15px] truncate">{guild?.name ?? 'BotCord'}</span>
          <IconChevronDown size={18} stroke={2} className="text-fg-muted shrink-0 ml-2" />
        </div>
        <div className="flex-1 min-h-0">
          <ChannelList guildId={guild?.id ?? null} selected={channelId} onSelect={setChannelId} unreadIds={unreads.channelIds} />
        </div>
        <BotIdentityFooter onOpenSettings={() => setSettingsOpen(true)} />
      </aside>
      <ChannelView channelId={channelId} guildId={guild?.id ?? null} channelName={channelName} />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      <Toaster />
    </div>
  );
}
