import type { ReactNode } from 'react';
import type { ContextMenuEntry } from './ContextMenu';
import type { BotCapabilities, GuildRole } from '../../shared/domain';

export type UserMenuTarget = {
  guildId: string;
  userId: string;
  username: string;
  displayName: string;
  // Role IDs currently assigned to this user (excluding @everyone).
  assignedRoleIds: Set<string>;
};

export type UserMenuCallbacks = {
  onOpenProfile: () => void;
  onMention: () => void;
  onCopyUsername: () => void;
  onCopyUserId: () => void;
  onOpenKick: () => void;
  onOpenBan: () => void;
  onOpenTimeout: () => void;
  // Role toggle: returns nothing — fires IPC and updates UI optimistically.
  onToggleRole: (roleId: string, currentlyAssigned: boolean) => void;
};

export function buildUserMenu({
  target, capabilities, roles, callbacks,
}: {
  target: UserMenuTarget;
  capabilities: BotCapabilities | null; // null while loading — items render disabled
  roles: GuildRole[] | null;            // null until first hover; passed when available
  callbacks: UserMenuCallbacks;
}): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = [];

  items.push({ type: 'item', label: 'Profile', onClick: callbacks.onOpenProfile });
  items.push({ type: 'separator' });

  // Roles submenu — hidden when target is the bot itself.
  if (!capabilities?.targetIsSelf) {
    const rolesDisabled = !capabilities?.canManageRoles;
    let title: string | undefined;
    if (capabilities && !capabilities.canManageRoles) {
      title = capabilities.outranksTarget
        ? 'Bot is missing the Manage Roles permission'
        : "Target's highest role is at or above the bot's highest role";
    }
    items.push({
      type: 'item',
      label: 'Roles',
      disabled: rolesDisabled,
      ...(title ? { title } : {}),
      submenu: buildRoleSubmenu({ target, roles, capabilities, onToggleRole: callbacks.onToggleRole }),
    });
    items.push({ type: 'separator' });
  }

  // Moderation actions — hidden when target is the bot itself.
  if (!capabilities?.targetIsSelf) {
    items.push(modItem('Timeout…', capabilities?.canTimeout ?? false, capabilities, 'Timeout Members', callbacks.onOpenTimeout));
    items.push(modItem('Kick…',    capabilities?.canKick ?? false,    capabilities, 'Kick Members',    callbacks.onOpenKick));
    items.push(modItem('Ban…',     capabilities?.canBan ?? false,     capabilities, 'Ban Members',     callbacks.onOpenBan));
    items.push({ type: 'separator' });
  }

  items.push({ type: 'item', label: 'Mention',       onClick: callbacks.onMention });
  items.push({ type: 'item', label: 'Copy Username', onClick: callbacks.onCopyUsername });
  items.push({ type: 'item', label: 'Copy User ID',  onClick: callbacks.onCopyUserId });

  return items;
}

function modItem(
  label: string,
  enabled: boolean,
  caps: BotCapabilities | null,
  permName: string,
  onClick: () => void,
): ContextMenuEntry {
  let title: string | undefined;
  if (caps && !enabled) {
    if (caps.missingPermissions.includes(permName)) {
      title = `Bot is missing the ${permName} permission`;
    } else if (!caps.outranksTarget) {
      title = "Target's highest role is at or above the bot's highest role";
    }
  }
  return {
    type: 'item',
    label,
    danger: true,
    onClick,
    disabled: !enabled,
    ...(title ? { title } : {}),
  };
}

function buildRoleSubmenu({
  target, roles, capabilities, onToggleRole,
}: {
  target: UserMenuTarget;
  roles: GuildRole[] | null;
  capabilities: BotCapabilities | null;
  onToggleRole: (roleId: string, currentlyAssigned: boolean) => void;
}): ContextMenuEntry[] {
  if (!roles) return [{ type: 'item', label: 'Loading roles…', disabled: true }];
  const assignable = roles.filter(r => !r.managed);
  if (assignable.length === 0) return [{ type: 'item', label: 'No assignable roles', disabled: true }];

  const botTop = capabilities?.botTopRolePosition ?? Infinity;
  return assignable.map<ContextMenuEntry>(r => {
    const assigned = target.assignedRoleIds.has(r.id);
    const aboveBot = r.position >= botTop;
    const title = aboveBot ? "Role is at or above the bot's highest role" : undefined;
    const icon: ReactNode = (
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden
          className={`relative inline-flex items-center justify-center w-[18px] h-[18px] rounded-[4px] border transition-colors ${
            assigned
              ? 'bg-accent border-accent'
              : 'bg-transparent border-white/30'
          }`}
        >
          {assigned && (
            <svg viewBox="0 0 16 16" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 8 7 12 13 4" />
            </svg>
          )}
        </span>
        <span
          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
          style={r.color ? { backgroundColor: r.color } : { backgroundColor: 'rgba(255,255,255,0.2)' }}
        />
      </span>
    );
    return {
      type: 'item',
      label: r.name,
      disabled: aboveBot,
      ...(title ? { title } : {}),
      icon,
      onClick: () => onToggleRole(r.id, assigned),
    };
  });
}
