import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { GuildAutonomyConfig, ChannelSummary } from '../../shared/domain';
import { pushToast } from './Toaster';
import { CheckBox } from './CheckBox';
import { IconSearch, IconX } from '@tabler/icons-react';
import { TextArea, NumberField } from './settings/fields';
import { useSaver } from './settings/SavingState';

export function AutonomySettingsTab({ guildId }: { guildId: string }) {
  const [cfg, setCfg] = useState<GuildAutonomyConfig | null>(null);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [detect, setDetect] = useState<{ found: boolean; version?: string; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const { trigger } = useSaver();

  useEffect(() => {
    api.autonomy.detect().then(setDetect);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.autonomy.getGuildConfig(guildId).then(r => { if (!cancelled && r.ok) setCfg(r.data); });
    api.guilds.listChannels(guildId).then(r => {
      if (!cancelled && r.ok) setChannels(r.data.filter(c => c.type === 'text'));
    });
    return () => { cancelled = true; };
  }, [guildId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter(c => c.name.toLowerCase().includes(q));
  }, [channels, query]);

  if (!cfg) return <div className="text-sm text-fg-muted">Loading…</div>;

  const save = async (partial: Partial<Omit<GuildAutonomyConfig, 'guildId' | 'updatedAt'>>) => {
    setBusy(true);
    const p = api.autonomy.setGuildConfig(guildId, partial);
    trigger(p);
    const res = await p;
    setBusy(false);
    if (res.ok) setCfg(res.data);
    else pushToast('danger', res.error.message);
  };

  const toggleChannel = (id: string) => {
    const next = cfg.channelIds.includes(id) ? cfg.channelIds.filter(x => x !== id) : [...cfg.channelIds, id];
    void save({ channelIds: next });
  };

  const filteredIds = filtered.map(c => c.id);
  const filteredEnabledCount = filteredIds.filter(id => cfg.channelIds.includes(id)).length;
  const allFilteredEnabled = filteredIds.length > 0 && filteredEnabledCount === filteredIds.length;
  const someFilteredEnabled = filteredEnabledCount > 0 && !allFilteredEnabled;

  const toggleAllVisible = () => {
    if (filteredIds.length === 0) return;
    const next = allFilteredEnabled
      ? cfg.channelIds.filter(id => !filteredIds.includes(id))
      : Array.from(new Set([...cfg.channelIds, ...filteredIds]));
    void save({ channelIds: next });
  };

  return (
    <div className="space-y-4">
      {detect && !detect.found && (
        <div className="rounded border border-warn/50 bg-warn/10 px-3 py-2 text-xs text-fg">
          <div className="font-medium">Claude CLI not detected</div>
          <div className="text-fg-muted">{detect.reason ?? 'Install the Claude CLI to enable autonomy.'}</div>
        </div>
      )}

      <label className="flex items-center gap-3 text-sm cursor-pointer">
        <CheckBox
          checked={cfg.enabled}
          onChange={() => save({ enabled: !cfg.enabled })}
          ariaLabel="Enable autonomous replies in this server"
          disabled={busy}
        />
        <span className="text-fg font-medium">Enable autonomous replies in this server</span>
      </label>

      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs font-medium text-fg-muted">
            Channels (text only) — {cfg.channelIds.length} of {channels.length} enabled
          </div>
          <button
            type="button"
            onClick={toggleAllVisible}
            disabled={busy || filteredIds.length === 0}
            className="text-[11px] text-accent hover:text-accent-hover disabled:opacity-50"
          >
            {allFilteredEnabled ? 'Unselect all' : 'Select all'}
            {query.trim() ? ' (filtered)' : ''}
          </button>
        </div>
        <div className="rounded-md border border-border bg-bg">
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <IconSearch size={14} stroke={2} className="text-fg-dim shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search channels"
              className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-dim min-w-0"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-fg-muted hover:text-fg shrink-0" title="Clear">
                <IconX size={14} stroke={2} />
              </button>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto">
            {channels.length === 0 && (
              <div className="px-3 py-2 text-xs text-fg-muted">No text channels visible to the bot.</div>
            )}
            {channels.length > 0 && filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-fg-muted">No channels match "{query}".</div>
            )}
            {filtered.length > 1 && (
              <button
                type="button"
                onClick={toggleAllVisible}
                disabled={busy}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-hover border-b border-border text-left"
              >
                <CheckBox
                  checked={allFilteredEnabled}
                  indeterminate={someFilteredEnabled}
                  onChange={toggleAllVisible}
                  ariaLabel={allFilteredEnabled ? 'Unselect all visible' : 'Select all visible'}
                  disabled={busy}
                />
                <span className="text-fg-muted text-xs">
                  {allFilteredEnabled ? 'Unselect' : 'Select'} all {query.trim() ? 'visible' : ''}
                  {' '}({filtered.length})
                </span>
              </button>
            )}
            {filtered.map(c => {
              const checked = cfg.channelIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleChannel(c.id)}
                  disabled={busy}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-hover text-left"
                >
                  <CheckBox checked={checked} onChange={() => toggleChannel(c.id)} ariaLabel={c.name} disabled={busy} />
                  <span className="text-fg-dim">#</span>
                  <span className="text-fg truncate">{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <NumberField
        label="Context window"
        unit="msgs"
        hint="Recent messages used as background context."
        value={cfg.contextSize}
        onChange={(v) => save({ contextSize: v })}
        min={5}
        max={100}
        disabled={busy}
      />

      <TextArea
        label="Persona"
        hint="System prompt for this server. Leave empty to use the global default."
        value={cfg.systemPrompt ?? ''}
        onChange={(v) => setCfg({ ...cfg, systemPrompt: v })}
        onBlur={() => save({ systemPrompt: cfg.systemPrompt && cfg.systemPrompt.trim().length > 0 ? cfg.systemPrompt : null })}
        rows={12}
        disabled={busy}
      />

      <NumberField
        label="Cooldown"
        unit="ms"
        hint="Minimum gap between auto-replies in the same channel."
        value={cfg.cooldownMs}
        onChange={(v) => save({ cooldownMs: v })}
        min={1000}
        step={500}
        disabled={busy}
      />
    </div>
  );
}
