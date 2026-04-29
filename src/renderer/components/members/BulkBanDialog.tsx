import { useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { api } from '../../lib/api';
import { pushToast } from '../Toaster';
import type { BulkActionResult } from '../../../shared/domain';

const HISTORY_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: "Don't delete any", seconds: 0 },
  { label: 'Last hour', seconds: 60 * 60 },
  { label: 'Last 6 hours', seconds: 6 * 60 * 60 },
  { label: 'Last 12 hours', seconds: 12 * 60 * 60 },
  { label: 'Last 24 hours', seconds: 24 * 60 * 60 },
  { label: 'Last 3 days', seconds: 3 * 24 * 60 * 60 },
  { label: 'Last 7 days', seconds: 7 * 24 * 60 * 60 },
];

export function BulkBanDialog({
  guildId, userIds, onClose, onSuccess,
}: {
  guildId: string;
  userIds: string[];
  onClose: () => void;
  onSuccess: (result: BulkActionResult) => void;
}) {
  const [reason, setReason] = useState('');
  const [historySeconds, setHistorySeconds] = useState(0);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await api.guilds.bulkBanMembers(guildId, userIds, {
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      deleteMessageSeconds: historySeconds,
    });
    setBusy(false);
    if (!res.ok) { pushToast('danger', res.error.message); return; }
    const r = res.data;
    pushToast(
      r.failed.length === 0 ? 'ok' : 'warn',
      `Banned ${r.ok.length} member(s)${r.failed.length ? `, ${r.failed.length} failed` : ''}`,
    );
    onSuccess(r);
    onClose();
  };

  return (
    <ConfirmDialog
      title={`Ban ${userIds.length} member${userIds.length === 1 ? '' : 's'}?`}
      description="They will be removed and prevented from rejoining."
      confirmLabel="Ban"
      busy={busy}
      onCancel={onClose}
      onConfirm={submit}
    >
      <label className="block text-[12px] text-fg-dim mb-1">Reason (optional, shown in audit log)</label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 512))}
        maxLength={512}
        className="w-full px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
        placeholder="Why are you banning them?"
      />
      <label className="block text-[12px] text-fg-dim mb-1 mt-3">Delete message history</label>
      <select
        value={historySeconds}
        onChange={(e) => setHistorySeconds(Number(e.target.value))}
        className="w-full px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
      >
        {HISTORY_OPTIONS.map(o => (
          <option key={o.seconds} value={o.seconds}>{o.label}</option>
        ))}
      </select>
    </ConfirmDialog>
  );
}
