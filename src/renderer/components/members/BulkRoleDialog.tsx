import { useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { api } from '../../lib/api';
import { pushToast } from '../Toaster';
import type { GuildRole, BulkActionResult } from '../../../shared/domain';

export function BulkRoleDialog({
  mode, guildId, userIds, roles, onClose, onSuccess,
}: {
  mode: 'add' | 'remove';
  guildId: string;
  userIds: string[];
  roles: GuildRole[];
  onClose: () => void;
  onSuccess: (result: BulkActionResult) => void;
}) {
  const [roleId, setRoleId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const assignable = roles.filter(r => !r.managed);

  const submit = async () => {
    if (!roleId) return;
    setBusy(true);
    const res = mode === 'add'
      ? await api.guilds.bulkAssignRole(guildId, userIds, roleId)
      : await api.guilds.bulkRemoveRole(guildId, userIds, roleId);
    setBusy(false);
    if (!res.ok) {
      pushToast('danger', res.error.message);
      return;
    }
    const r = res.data;
    pushToast(
      r.failed.length === 0 ? 'ok' : 'warn',
      `${mode === 'add' ? 'Assigned' : 'Removed'} role on ${r.ok.length} member(s)${r.failed.length ? `, ${r.failed.length} failed` : ''}`,
    );
    onSuccess(r);
    onClose();
  };

  return (
    <ConfirmDialog
      title={`${mode === 'add' ? 'Add' : 'Remove'} role on ${userIds.length} member${userIds.length === 1 ? '' : 's'}`}
      confirmLabel={mode === 'add' ? 'Add role' : 'Remove role'}
      danger={mode === 'remove'}
      busy={busy}
      onCancel={onClose}
      onConfirm={submit}
    >
      <label className="block text-[12px] text-fg-dim mb-1">Role</label>
      <select
        value={roleId}
        onChange={(e) => setRoleId(e.target.value)}
        className="w-full px-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
      >
        <option value="">Select a role…</option>
        {assignable.map(r => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
    </ConfirmDialog>
  );
}
