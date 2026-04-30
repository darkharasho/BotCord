import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { GuildAutonomyConfig, ChannelSummary } from '../../shared/domain';
import { pushToast } from './Toaster';

export function AutonomySettingsTab({ guildId }: { guildId: string }) {
  const [cfg, setCfg] = useState<GuildAutonomyConfig | null>(null);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [detect, setDetect] = useState<{ found: boolean; version?: string; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (!cfg) return <div className="text-sm text-fg-muted">Loading…</div>;

  const save = async (partial: Partial<Omit<GuildAutonomyConfig, 'guildId' | 'updatedAt'>>) => {
    setBusy(true);
    const res = await api.autonomy.setGuildConfig(guildId, partial);
    setBusy(false);
    if (res.ok) setCfg(res.data);
    else pushToast('danger', res.error.message);
  };

  const toggleChannel = (id: string) => {
    const next = cfg.channelIds.includes(id) ? cfg.channelIds.filter(x => x !== id) : [...cfg.channelIds, id];
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

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cfg.enabled} onChange={e => save({ enabled: e.target.checked })} disabled={busy} />
        Enable autonomous replies in this server
      </label>

      <div>
        <div className="text-xs font-medium text-fg-muted mb-1">Channels (text only)</div>
        <div className="max-h-48 overflow-y-auto rounded border border-border bg-bg-sunken">
          {channels.length === 0 && <div className="px-3 py-2 text-xs text-fg-muted">No text channels visible to the bot.</div>}
          {channels.map(c => (
            <label key={c.id} className="flex items-center gap-2 px-3 py-1 text-sm hover:bg-hover cursor-pointer">
              <input type="checkbox" checked={cfg.channelIds.includes(c.id)} onChange={() => toggleChannel(c.id)} disabled={busy} />
              <span># {c.name}</span>
            </label>
          ))}
        </div>
      </div>

      <label className="block text-sm">
        <span className="block text-xs font-medium text-fg-muted mb-1">Context window (recent messages used as background)</span>
        <input
          type="number"
          min={5}
          max={100}
          value={cfg.contextSize}
          onChange={e => save({ contextSize: Math.max(5, Math.min(100, parseInt(e.target.value || '20', 10))) })}
          className="w-24 px-2 py-1 rounded bg-bg-sunken border border-border text-fg text-sm"
          disabled={busy}
        />
      </label>

      <label className="block text-sm">
        <span className="block text-xs font-medium text-fg-muted mb-1">Persona (system prompt — empty uses global default)</span>
        <textarea
          rows={6}
          value={cfg.systemPrompt ?? ''}
          onChange={e => setCfg({ ...cfg, systemPrompt: e.target.value })}
          onBlur={() => save({ systemPrompt: cfg.systemPrompt && cfg.systemPrompt.trim().length > 0 ? cfg.systemPrompt : null })}
          className="w-full px-2 py-1 rounded bg-bg-sunken border border-border text-fg text-sm"
          disabled={busy}
        />
      </label>

      <label className="block text-sm">
        <span className="block text-xs font-medium text-fg-muted mb-1">Cooldown (ms between auto-replies in same channel)</span>
        <input
          type="number"
          min={1000}
          step={500}
          value={cfg.cooldownMs}
          onChange={e => save({ cooldownMs: Math.max(1000, parseInt(e.target.value || '5000', 10)) })}
          className="w-32 px-2 py-1 rounded bg-bg-sunken border border-border text-fg text-sm"
          disabled={busy}
        />
      </label>
    </div>
  );
}
