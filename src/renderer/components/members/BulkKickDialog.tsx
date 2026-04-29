import { useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { api } from '../../lib/api';
import { pushToast } from '../Toaster';
import type { BulkActionResult } from '../../../shared/domain';

export function BulkKickDialog({
  guildId, userIds, onClose, onSuccess,
}: {
  guildId: string;
  userIds: string[];
  onClose: () => void;
  onSuccess: (result: BulkActionResult) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await api.guilds.bulkKickMembers(guildId, userIds, reason.trim() || undefined);
    setBusy(false);
    if (!res.ok) { pushToast('danger', res.error.message); return; }
    const r = res.data;
    pushToast(
      r.failed.length === 0 ? 'ok' : 'warn',
      `Kicked ${r.ok.length} member(s)${r.failed.length ? `, ${r.failed.length} failed` : ''}`,
    );
    onSuccess(r);
    onClose();
  };

  return (
    <ConfirmDialog
      title={`Kick ${userIds.length} member${userIds.length === 1 ? '' : 's'}?`}
      description="They will be removed from the server but can rejoin with a new invite."
      confirmLabel="Kick"
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
        placeholder="Why are you kicking them?"
      />
    </ConfirmDialog>
  );
}
