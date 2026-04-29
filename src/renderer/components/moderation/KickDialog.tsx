import { useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { api } from '../../lib/api';
import { pushToast } from '../Toaster';

export function KickDialog({
  guildId, userId, displayName, onClose,
}: { guildId: string; userId: string; displayName: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await api.guilds.kickMember(guildId, userId, reason.trim() || undefined);
    setBusy(false);
    if (res.ok) {
      pushToast('ok', `Kicked ${displayName}`);
      onClose();
    } else {
      pushToast('danger', res.error.message);
    }
  };

  return (
    <ConfirmDialog
      title={`Kick ${displayName}?`}
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
