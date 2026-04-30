import { useEffect, useState } from 'react';
import type { GlobalAutonomyConfig } from '../../shared/domain';
import { AUTONOMY_MODEL_OPTIONS } from '../../shared/domain';
import { pushToast } from './Toaster';
import { useGlobalAutonomy } from '../lib/use-global-autonomy';
import { CheckBox } from './CheckBox';

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
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <CheckBox
          checked={cfg.enabled}
          onChange={() => save({ enabled: !cfg.enabled })}
          ariaLabel="Enable autonomy globally"
          disabled={busy}
        />
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
        <span className="block text-xs font-medium text-fg-muted mb-1">Model</span>
        <select
          value={cfg.model}
          onChange={e => save({ model: e.target.value })}
          disabled={busy}
          className="w-full px-2 py-1 rounded bg-bg-sunken border border-border text-fg text-sm"
        >
          {AUTONOMY_MODEL_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
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
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <CheckBox
          checked={cfg.visionEnabled}
          onChange={() => save({ visionEnabled: !cfg.visionEnabled })}
          ariaLabel="Send images to Claude"
          disabled={busy}
        />
        <span>
          Send images to Claude (vision)
          <span className="block text-[11px] text-fg-muted">
            When off, image attachments are described as <code>[image: name.png]</code>. When on, the actual image is downloaded and shown to Claude. Slower and uses more tokens.
          </span>
        </span>
      </label>
    </div>
  );
}
