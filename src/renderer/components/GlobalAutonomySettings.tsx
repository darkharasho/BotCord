import { useEffect, useState } from 'react';
import type { GlobalAutonomyConfig } from '../../shared/domain';
import { AUTONOMY_MODEL_OPTIONS } from '../../shared/domain';
import { pushToast } from './Toaster';
import { useGlobalAutonomy } from '../lib/use-global-autonomy';
import { CheckBox } from './CheckBox';
import { TextArea, NumberField, SelectField } from './settings/fields';

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
    <div className="space-y-6">
      <label className="flex items-center gap-3 cursor-pointer">
        <CheckBox
          checked={cfg.enabled}
          onChange={() => save({ enabled: !cfg.enabled })}
          ariaLabel="Enable autonomy globally"
          disabled={busy}
        />
        <span className="text-sm text-fg font-medium">
          Enable autonomy globally <span className="text-fg-dim font-normal">(kill switch)</span>
        </span>
      </label>

      <TextArea
        label="Default persona"
        hint="System prompt used when a server has no override."
        value={draftPrompt}
        onChange={setDraftPrompt}
        onBlur={() => save({ systemPrompt: draftPrompt })}
        rows={5}
        disabled={busy}
      />

      <SelectField
        label="Model"
        value={cfg.model}
        onChange={(v) => save({ model: v })}
        options={AUTONOMY_MODEL_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
        disabled={busy}
      />

      <NumberField
        label="Global rate cap"
        unit="/min"
        hint="Maximum responses per minute across all servers."
        value={cfg.rateCapPerMin}
        onChange={(v) => save({ rateCapPerMin: v })}
        min={1}
        max={120}
        disabled={busy}
      />

      <label className="flex items-start gap-3 cursor-pointer">
        <CheckBox
          checked={cfg.visionEnabled}
          onChange={() => save({ visionEnabled: !cfg.visionEnabled })}
          ariaLabel="Send images to Claude"
          disabled={busy}
        />
        <span>
          <span className="block text-sm text-fg font-medium">Send images to Claude (vision)</span>
          <span className="block text-[11px] text-fg-muted mt-0.5 leading-relaxed">
            When off, image attachments are described as <code className="font-mono">[image: name.png]</code>. When on, the actual image is downloaded and shown to Claude. Slower and uses more tokens.
          </span>
        </span>
      </label>

      <div className="grid grid-cols-2 gap-4">
        <NumberField
          label="Queue depth"
          unit="msgs"
          hint="Per-channel max. Beyond this, oldest is dropped."
          value={cfg.queueMaxDepth}
          onChange={(v) => save({ queueMaxDepth: v })}
          min={1}
          max={50}
          disabled={busy}
        />
        <NumberField
          label="Queue TTL"
          unit="sec"
          hint="How long a queued trigger waits before being dropped as stale."
          value={cfg.queueTtlSeconds}
          onChange={(v) => save({ queueTtlSeconds: v })}
          min={5}
          max={600}
          disabled={busy}
        />
      </div>
    </div>
  );
}
