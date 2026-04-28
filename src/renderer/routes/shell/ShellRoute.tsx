import { useEffect, useState } from 'react';
import { ServerRail } from '../../components/ServerRail';
import { ChannelList } from '../../components/ChannelList';
import { StatusPill } from '../../components/StatusPill';
import { SettingsPanel } from '../../components/SettingsPanel';
import { Toaster } from '../../components/Toaster';
import { ChannelView } from './ChannelView';
import { api } from '../../lib/api';
import type { ChannelSummary } from '../../../shared/domain';
import { IconSettings } from '@tabler/icons-react';

export function ShellRoute() {
  const [guildId, setGuildId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!guildId) { setChannels([]); return; }
    api.guilds.listChannels(guildId).then(res => { if (res.ok) setChannels(res.data); });
  }, [guildId]);

  const channelName = channels.find(c => c.id === channelId)?.name ?? null;

  return (
    <div className="h-full flex">
      <aside className="w-[72px] shrink-0 min-h-0">
        <ServerRail selected={guildId} onSelect={(id) => { setGuildId(id); setChannelId(null); }} />
      </aside>
      <aside className="w-60 shrink-0 min-h-0 bg-bg-subtle flex flex-col">
        <div className="h-12 px-4 flex items-center justify-between shadow-[0_1px_0_rgba(0,0,0,0.2),0_1.5px_0_rgba(0,0,0,0.05),0_2px_0_rgba(0,0,0,0.05)] z-10 shrink-0">
          <span className="font-semibold text-fg text-[15px] truncate">BotCord</span>
          <button
            className="text-fg-dim hover:text-fg"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          ><IconSettings size={20} stroke={1.75} /></button>
        </div>
        <div className="flex-1 min-h-0">
          <ChannelList guildId={guildId} selected={channelId} onSelect={setChannelId} />
        </div>
        <div className="h-[52px] px-2 flex items-center bg-bg-sunken shrink-0">
          <StatusPill />
        </div>
      </aside>
      <ChannelView channelId={channelId} guildId={guildId} channelName={channelName} />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      <Toaster />
    </div>
  );
}
