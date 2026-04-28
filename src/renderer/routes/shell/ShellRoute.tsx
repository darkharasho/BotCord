import { useEffect, useState } from 'react';
import { ServerRail } from '../../components/ServerRail';
import { ChannelList } from '../../components/ChannelList';
import { StatusPill } from '../../components/StatusPill';
import { SettingsPanel } from '../../components/SettingsPanel';
import { Toaster } from '../../components/Toaster';
import { ChannelView } from './ChannelView';
import { api } from '../../lib/api';
import type { ChannelSummary } from '../../../shared/domain';

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
    <div className="h-full flex flex-col">
      <header className="h-10 border-b border-border flex items-center justify-between px-3 bg-bg-subtle shrink-0">
        <div className="font-semibold tracking-tight">BotCord</div>
        <div className="flex items-center gap-3">
          <StatusPill />
          <button className="text-xs text-fg-muted hover:text-fg" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </header>
      <div className="flex-1 grid grid-cols-[72px_240px_1fr] min-h-0">
        <aside className="border-r border-border min-h-0">
          <ServerRail selected={guildId} onSelect={(id) => { setGuildId(id); setChannelId(null); }} />
        </aside>
        <aside className="border-r border-border min-h-0 bg-bg-subtle/40">
          <ChannelList guildId={guildId} selected={channelId} onSelect={setChannelId} />
        </aside>
        <ChannelView channelId={channelId} guildId={guildId} channelName={channelName} />
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      <Toaster />
    </div>
  );
}
