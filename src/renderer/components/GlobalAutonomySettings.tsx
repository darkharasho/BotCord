import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { GlobalAutonomyConfig } from '../../shared/domain';
import { pushToast } from './Toaster';

export function GlobalAutonomySettings() {
  const [cfg, setCfg] = useState<GlobalAutonomyConfig | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.autonomy.getGlobalConfig().then(r => { if (r.ok) setCfg(r.data); });
  }, []);

  if (!cfg) return null;

  const save = async (partial: Partial<GlobalAutonomyConfig>) => {
    setBusy(true);
    const res = await api.autonomy.setGlobalConfig(partial);
    setBusy(false);
    if (res.ok) setCfg(res.data);
    else pushToast('danger', res.error.message);
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-fg">Autonomy</h3>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cfg.enabled} onChange={e => save({ enabled: e.target.checked })} disabled={busy} />
        Enable autonomy globally (kill switch)
      </label>
      <label className="block text-sm">
        <span className="block text-xs font-medium text-fg-muted mb-1">Default persona (used when a server has no override)</span>
        <textarea
          rows={5}
          value={cfg.systemPrompt}
          onChange={e => setCfg({ ...cfg, systemPrompt: e.target.value })}
          onBlur={() => save({ systemPrompt: cfg.systemPrompt })}
          className="w-full px-2 py-1 rounded bg-bg-sunken border border-border text-fg text-sm"
          disabled={busy}
        />
      </label>
      <label className="block text-sm">
        <span className="block text-xs font-medium text-fg-muted mb-1">Global rate cap (responses per minute)</span>
        <input
          type="number"
          min={1}
          max={120}
          value={cfg.rateCapPerMin}
          onChange={e => save({ rateCapPerMin: Math.max(1, Math.min(120, parseInt(e.target.value || '20', 10))) })}
          className="w-24 px-2 py-1 rounded bg-bg-sunken border border-border text-fg text-sm"
          disabled={busy}
        />
      </label>
    </div>
  );
}
