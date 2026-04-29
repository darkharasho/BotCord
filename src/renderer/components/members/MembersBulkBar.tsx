import { useState } from 'react';
import { BulkRoleDialog } from './BulkRoleDialog';
import { BulkKickDialog } from './BulkKickDialog';
import { BulkBanDialog } from './BulkBanDialog';
import type { GuildRole, BulkActionResult } from '../../../shared/domain';

type DialogState =
  | { kind: 'addRole' | 'removeRole' }
  | { kind: 'kick' }
  | { kind: 'ban' }
  | null;

export function MembersBulkBar({
  guildId, selectedIds, roles, onClear, onActionComplete,
}: {
  guildId: string;
  selectedIds: string[];
  roles: GuildRole[];
  onClear: () => void;
  onActionComplete: (result: BulkActionResult) => void;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  if (selectedIds.length === 0) return null;

  return (
    <>
      <div className="px-4 py-3 border-t border-white/[0.04] bg-bg flex items-center gap-2">
        <span className="text-fg text-[13px]">{selectedIds.length} selected</span>
        <button onClick={onClear} className="text-fg-dim text-[12px] hover:text-fg">Clear</button>
        <div className="flex-1" />
        <button
          onClick={() => setDialog({ kind: 'addRole' })}
          className="px-3 py-1.5 rounded text-[13px] bg-bg-input hover:bg-hover text-fg"
        >Add role</button>
        <button
          onClick={() => setDialog({ kind: 'removeRole' })}
          className="px-3 py-1.5 rounded text-[13px] bg-bg-input hover:bg-hover text-fg"
        >Remove role</button>
        <button
          onClick={() => setDialog({ kind: 'kick' })}
          className="px-3 py-1.5 rounded text-[13px] bg-danger/20 hover:bg-danger/40 text-danger"
        >Kick</button>
        <button
          onClick={() => setDialog({ kind: 'ban' })}
          className="px-3 py-1.5 rounded text-[13px] bg-danger hover:bg-danger/80 text-white"
        >Ban</button>
      </div>
      {dialog?.kind === 'addRole' && (
        <BulkRoleDialog
          mode="add"
          guildId={guildId}
          userIds={selectedIds}
          roles={roles}
          onClose={() => setDialog(null)}
          onSuccess={onActionComplete}
        />
      )}
      {dialog?.kind === 'removeRole' && (
        <BulkRoleDialog
          mode="remove"
          guildId={guildId}
          userIds={selectedIds}
          roles={roles}
          onClose={() => setDialog(null)}
          onSuccess={onActionComplete}
        />
      )}
      {dialog?.kind === 'kick' && (
        <BulkKickDialog
          guildId={guildId}
          userIds={selectedIds}
          onClose={() => setDialog(null)}
          onSuccess={onActionComplete}
        />
      )}
      {dialog?.kind === 'ban' && (
        <BulkBanDialog
          guildId={guildId}
          userIds={selectedIds}
          onClose={() => setDialog(null)}
          onSuccess={onActionComplete}
        />
      )}
    </>
  );
}
