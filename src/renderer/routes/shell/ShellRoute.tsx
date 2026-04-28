import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GuildList } from '../../components/GuildList';
import { ChannelList } from '../../components/ChannelList';
import { StatusPill } from '../../components/StatusPill';
import { SettingsPanel } from '../../components/SettingsPanel';
import { Toaster } from '../../components/Toaster';

export function ShellRoute() {
  const [guildId, setGuildId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="h-full flex flex-col">
      <header className="h-10 border-b border-border flex items-center justify-between px-3 bg-bg-subtle">
        <div className="font-semibold tracking-tight">BotCord</div>
        <div className="flex items-center gap-3">
          <StatusPill />
          <button className="text-xs text-fg-muted hover:text-fg" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </header>
      <div className="flex-1 grid grid-cols-[220px_240px_1fr] min-h-0">
        <aside className="border-r border-border bg-bg-sunken min-h-0">
          <GuildList selected={guildId} onSelect={(id) => { setGuildId(id); setChannelId(null); }} />
        </aside>
        <aside className="border-r border-border min-h-0">
          <ChannelList guildId={guildId} selected={channelId} onSelect={setChannelId} />
        </aside>
        <main className="p-6 overflow-y-auto">
          {channelId ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Channel selected</h2>
              <p className="text-fg-muted text-sm">Select an action:</p>
              <Link
                to="/compose"
                className="inline-block px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover"
              >
                Open embed composer
              </Link>
            </div>
          ) : (
            <p className="text-fg-muted">Select a channel to begin.</p>
          )}
        </main>
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      <Toaster />
    </div>
  );
}
