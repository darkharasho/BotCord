import { useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { api } from '../../lib/api';
import { pushToast } from '../Toaster';

const PRESETS: Array<{ label: string; ms: number }> = [
  { label: '1 minute',  ms: 60_000 },
  { label: '5 minutes', ms: 5 * 60_000 },
  { label: '10 minutes', ms: 10 * 60_000 },
  { label: '1 hour',    ms: 60 * 60_000 },
  { label: '1 day',     ms: 24 * 60 * 60_000 },
  { label: '1 week',    ms: 7 * 24 * 60 * 60_000 },
];

const UNIT_MS: Record<string, number> = {
  minutes: 60_000,
  hours:   60 * 60_000,
  days:    24 * 60 * 60_000,
};

export function TimeoutDialog({
  guildId, userId, displayName, onClose,
}: { guildId: string; userId: string; displayName: string; onClose: () => void }) {
  const [presetMs, setPresetMs] = useState<number>(PRESETS[2]!.ms); // 10 min default
  const [customN, setCustomN] = useState<string>('');
  const [customUnit, setCustomUnit] = useState<keyof typeof UNIT_MS>('minutes');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const customMs = (() => {
    const n = Number(customN);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n * UNIT_MS[customUnit]!);
  })();
  const effectiveMs = customMs > 0 ? customMs : presetMs;
  const tooLong = effectiveMs > 28 * 24 * 60 * 60_000;

  const submit = async () => {
    if (effectiveMs <= 0 || tooLong) return;
    setBusy(true);
    const res = await api.guilds.timeoutMember(guildId, userId, effectiveMs, reason.trim() || undefined);
    setBusy(false);
    if (res.ok) {
      pushToast('ok', `Timed out ${displayName}`);
      onClose();
    } else {
      pushToast('danger', res.error.message);
    }
  };

  return (
    <ConfirmDialog
      title={`Timeout ${displayName}?`}
      description="They won't be able to send messages or react until the timeout expires."
      confirmLabel="Timeout"
      busy={busy}
      onCancel={onClose}
      onConfirm={submit}
    >
      <label className="block text-[12px] text-fg-dim mb-1">Duration</label>
      <select
        value={customMs > 0 ? '' : String(presetMs)}
        onChange={(e) => { if (e.target.value) { setPresetMs(Number(e.target.value)); setCustomN(''); } }}
        className="w-full px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
      >
        {PRESETS.map(p => <option key={p.ms} value={p.ms}>{p.label}</option>)}
        <option value="">Custom…</option>
      </select>
      <div className="flex gap-2 mt-2">
        <input
          type="number"
          min={0}
          value={customN}
          onChange={(e) => setCustomN(e.target.value)}
          placeholder="0"
          className="flex-1 px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
        />
        <select
          value={customUnit}
          onChange={(e) => setCustomUnit(e.target.value as keyof typeof UNIT_MS)}
          className="px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
        >
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
      </div>
      {tooLong && <div className="text-[12px] text-danger mt-1">Maximum timeout is 28 days.</div>}
      <label className="block text-[12px] text-fg-dim mb-1 mt-3">Reason (optional, shown in audit log)</label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 512))}
        maxLength={512}
        className="w-full px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
        placeholder="Why are you timing them out?"
      />
    </ConfirmDialog>
  );
}
