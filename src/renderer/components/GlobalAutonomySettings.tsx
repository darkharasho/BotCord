import { useEffect, useState } from 'react';
import type { GlobalAutonomyConfig } from '../../shared/domain';
import { pushToast } from './Toaster';
import { useGlobalAutonomy } from '../lib/use-global-autonomy';

export function GlobalAutonomySettings() {
  const { cfg, set } = useGlobalAutonomy();
  const [draftPrompt, setDraftPrompt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cfg && draftPrompt === null) setDraftPrompt(cfg.systemPrompt);
  }, [cfg, draftPrompt]);

  if (!cfg || draftPrompt === null) return null;

  const save = async (partial: Partial<GlobalAutonomyConfig>) => {
    setBusy(true);
    try { await set(partial); }
    catch (e) { pushToast('danger', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
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
          value={draftPrompt}
          onChange={e => setDraftPrompt(e.target.value)}
          onBlur={() => save({ systemPrompt: draftPrompt })}
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
