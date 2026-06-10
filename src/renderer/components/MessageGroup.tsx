import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MessageSummary } from '../../shared/domain';
import { MessageContent } from './MessageContent';
import { Markdown } from './Markdown';
import {
  IconCornerUpLeft, IconMoodPlus, IconDots, IconPencil, IconTrash,
  IconPinned, IconCopy, IconLink, IconHash, IconPinnedOff, IconArrowRight, IconSparkles,
} from '@tabler/icons-react';
import { useBotIdentity } from '../lib/use-bot-identity';
import { useGuildEmojis } from '../lib/use-guild-emojis';
import { useAutonomyThinkingForChannel } from '../lib/use-autonomy-thinking';
import { MessageThinkingIndicator } from './MessageThinkingIndicator';
import { useExclusivePopover } from '../lib/use-exclusive-popover';
import { EmojiPicker } from './EmojiPicker';
import { api } from '../lib/api';
import { pushToast } from './Toaster';
import { emitComposerBus } from '../lib/composer-bus';
import { openContextMenu, updateContextMenuItems, type ContextMenuEntry } from './ContextMenu';
import { Avatar } from './Avatar';
import { UserProfileCard } from './UserProfileCard';
import { KickDialog } from './moderation/KickDialog';
import { BanDialog } from './moderation/BanDialog';
import { TimeoutDialog } from './moderation/TimeoutDialog';
import { buildUserMenu, type UserMenuTarget } from './UserContextMenu';
import type { GuildRole, BotCapabilities, MemberDetail } from '../../shared/domain';
import { EmbedModal } from './EmbedModal';

// Approximate height of the EmojiPicker popover (max-h-96). Used to decide
// whether to open above or below the trigger when space is tight.
const PICKER_HEIGHT = 384;

function mentionsBot(m: MessageSummary, botId: string | undefined): boolean {
  if (!botId) return false;
  return m.mentions.some(x => x.type === 'user' && x.id === botId);
}

const MENTION_ROW = 'before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-warn bg-warn/[0.06] hover:bg-warn/[0.10]';

function formatHeaderTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const wasYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today at ${time}`;
  if (wasYesterday) return `Yesterday at ${time}`;
  return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' }) + ' ' + time;
}

function formatGutterTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function generateReplyWithClaude(channelId: string, messageId: string, authorDisplayName: string): void {
  void (async () => {
    const detect = await api.autonomy.detect();
    if (!detect.found) {
      pushToast('warn', `Claude CLI not available: ${detect.reason ?? 'unknown'}`);
      return;
    }
    emitComposerBus({ kind: 'clear', channelId });
    emitComposerBus({ kind: 'setReplyTarget', channelId, messageId, authorDisplayName });
    emitComposerBus({ kind: 'generatingStart', channelId });
    const res = await api.autonomy.draftReply(channelId, messageId);
    if (!res.ok) {
      emitComposerBus({ kind: 'generatingEnd', channelId });
      pushToast('danger', `Generate failed: ${res.error.message}`);
      return;
    }
    const requestId = res.data.requestId;
    const offDelta = api.events.onAutonomyDraftDelta(({ requestId: rid, delta }) => {
      if (rid !== requestId) return;
      emitComposerBus({ kind: 'append', channelId, text: delta });
    });
    const offDone = api.events.onAutonomyDraftDone(({ requestId: rid }) => {
      if (rid !== requestId) return;
      emitComposerBus({ kind: 'generatingEnd', channelId });
      offDelta();
      offDone();
    });
  })();
}

// Builds the right-click menu items for a single message.
function buildMessageMenu({
  message, isOwn, onReply, onEdit, onAddReaction, onGenerateClaudeReply,
}: {
  message: MessageSummary;
  isOwn: boolean;
  onReply?: () => void;
  onEdit: () => void;
  onAddReaction: () => void;
  onGenerateClaudeReply?: () => void;
}): ContextMenuEntry[] {
  const iconCls = 'w-4 h-4 stroke-[1.75]';
  const items: ContextMenuEntry[] = [
    { type: 'item', label: 'Add Reaction', onClick: onAddReaction, icon: <IconMoodPlus className={iconCls} /> },
    { type: 'separator' },
  ];
  if (onReply) {
    items.push({ type: 'item', label: 'Reply', onClick: onReply, icon: <IconCornerUpLeft className={`${iconCls} scale-x-[-1]`} /> });
    items.push({ type: 'separator' });
  }
  if (onGenerateClaudeReply) {
    items.push({
      type: 'item',
      label: 'Generate reply with Claude',
      onClick: onGenerateClaudeReply,
      icon: <IconSparkles className={iconCls} />,
    });
    items.push({ type: 'separator' });
  }
  if (message.content) {
    items.push({
      type: 'item',
      label: 'Copy Text',
      onClick: () => { void api.system.copyText(message.content); pushToast('ok', 'Copied'); },
      icon: <IconCopy className={iconCls} />,
    });
  }
  items.push({
    type: 'item',
    label: message.pinned ? 'Unpin Message' : 'Pin Message',
    icon: message.pinned ? <IconPinnedOff className={iconCls} /> : <IconPinned className={iconCls} />,
    onClick: async () => {
      const wasPinned = message.pinned;
      try {
        const res = wasPinned
          ? await api.messages.unpin(message.channelId, message.id)
          : await api.messages.pin(message.channelId, message.id);
        if (res.ok) {
          pushToast('ok', wasPinned ? 'Message unpinned' : 'Message pinned');
        } else {
          pushToast('danger', `Couldn't ${wasPinned ? 'unpin' : 'pin'}: ${res.error.message}`);
        }
      } catch (e) {
        pushToast('danger', `Pin failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  });
  if (message.guildId) {
    items.push({
      type: 'item',
      label: 'Copy Message Link',
      onClick: () => {
        const url = `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
        void api.system.copyText(url);
        pushToast('ok', 'Link copied');
      },
      icon: <IconLink className={iconCls} />,
    });
  }
  if (isOwn) {
    items.push({ type: 'separator' });
    items.push({ type: 'item', label: 'Edit Message', onClick: onEdit, icon: <IconPencil className={iconCls} /> });
  }
  items.push({ type: 'separator' });
  items.push({
    type: 'item',
    label: 'Delete Message',
    danger: true,
    icon: <IconTrash className={iconCls} />,
    onClick: async () => {
      if (!window.confirm('Delete this message?')) return;
      const res = await api.messages.delete(message.channelId, message.id);
      if (!res.ok) pushToast('danger', `Couldn't delete: ${res.error.message}`);
    },
  });
  items.push({ type: 'separator' });
  items.push({
    type: 'item',
    label: 'Copy Message ID',
    onClick: () => { void api.system.copyText(message.id); pushToast('ok', 'ID copied'); },
    icon: <IconHash className={iconCls} />,
  });
  return items;
}

export function MessageGroup({ messages, onReply, onJumpToMessage }: { messages: MessageSummary[]; onReply?: ((m: MessageSummary) => void) | undefined; onJumpToMessage?: ((id: string) => void) | undefined }) {
  if (messages.length === 0) return null;
  const head = messages[0]!;
  const bot = useBotIdentity();
  const thinkingSet = useAutonomyThinkingForChannel(head.channelId);
  // One message in the group at most can be in inline-edit mode.
  const [editingId, setEditingId] = useState<string | null>(null);
  // When set, edit a sent embed via the modal instead of the inline editor.
  const [embedEdit, setEmbedEdit] = useState<MessageSummary | null>(null);

  // A message is embed-editable when the bot owns it and it carries exactly
  // one rich embed (link-preview / multi-embed messages stay text-editable).
  const isEmbedEditable = (m: MessageSummary) =>
    bot?.id === m.authorId && m.embeds.length === 1 && m.embeds[0]!.type === 'rich';

  // Route edit to the embed modal or the inline text editor.
  const startEdit = (m: MessageSummary) => {
    if (isEmbedEditable(m)) setEmbedEdit(m);
    else setEditingId(m.id);
  };
  // Profile card state — anchored to the avatar/name that was clicked.
  const [profileState, setProfileState] = useState<{ userId: string; guildId: string; rect: DOMRect } | null>(null);
  // Add-reaction state triggered from the context menu — anchored to the
  // right-click coordinates so the picker opens where the user clicked.
  const [reactState, setReactState] = useState<{ message: MessageSummary; rect: DOMRect } | null>(null);
  const [modState, setModState] = useState<{ kind: 'kick' | 'ban' | 'timeout'; userId: string; displayName: string } | null>(null);
  const rolesCacheRef = useRef<Map<string, GuildRole[]>>(new Map());
  const guildEmojis = useGuildEmojis(reactState ? head.guildId : null);
  const openProfile = (e: React.MouseEvent, authorId: string) => {
    if (!head.guildId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setProfileState({ userId: authorId, guildId: head.guildId, rect });
  };

  const headHighlight = mentionsBot(head, bot?.id) ? MENTION_ROW : 'hover:bg-hover/40';

  const renderBody = (m: MessageSummary) => editingId === m.id
    ? <MessageEditor message={m} onDone={() => setEditingId(null)} />
    : <MessageContent message={m} onAddReaction={(rect) => setReactState({ message: m, rect })} />;

  const onAuthorContextMenu = async (e: React.MouseEvent, authorId: string, displayName: string, username: string) => {
    if (!head.guildId) return;
    e.preventDefault();
    e.stopPropagation(); // suppress the message-body context menu
    // React clears currentTarget after the handler returns, so snapshot
    // anything we need from the event before the awaits below.
    const anchorRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;

    const guildId = head.guildId;
    const [capRes, memRes] = await Promise.all([
      api.guilds.getBotCapabilities(guildId, authorId),
      api.guilds.getMember(guildId, authorId),
    ]);
    const capabilities: BotCapabilities | null = capRes.ok ? capRes.data : null;
    const detail: MemberDetail | null = memRes.ok ? memRes.data : null;
    if (!capabilities) { pushToast('danger', capRes.ok ? 'Failed to load capabilities' : capRes.error.message); return; }

    const target: UserMenuTarget = {
      guildId,
      userId: authorId,
      username,
      displayName,
      assignedRoleIds: new Set(detail?.roles.map(r => r.id) ?? []),
    };
    const buildItems = (roles: GuildRole[] | null) => buildUserMenu({
      target,
      capabilities,
      roles,
      callbacks: {
        onOpenProfile:  () => setProfileState({ userId: authorId, guildId, rect: anchorRect }),
        onMention:      () => { void api.system.copyText(`<@${authorId}>`); pushToast('ok', 'Mention copied'); },
        onCopyUsername: () => { void api.system.copyText(username); pushToast('ok', 'Username copied'); },
        onCopyUserId:   () => { void api.system.copyText(authorId); pushToast('ok', 'ID copied'); },
        onOpenKick:     () => setModState({ kind: 'kick',    userId: authorId, displayName }),
        onOpenBan:      () => setModState({ kind: 'ban',     userId: authorId, displayName }),
        onOpenTimeout:  () => setModState({ kind: 'timeout', userId: authorId, displayName }),
        onToggleRole: async (roleId, currentlyAssigned) => {
          const res = currentlyAssigned
            ? await api.guilds.removeRole(guildId, authorId, roleId)
            : await api.guilds.assignRole(guildId, authorId, roleId);
          if (!res.ok) pushToast('danger', res.error.message);
        },
      },
    });

    const rolesNow = rolesCacheRef.current.get(guildId) ?? null;
    openContextMenu({ preventDefault: () => {}, clientX, clientY }, buildItems(rolesNow));

    if (!rolesNow) {
      api.guilds.listGuildRoles(guildId).then(res => {
        if (!res.ok) return;
        rolesCacheRef.current.set(guildId, res.data);
        updateContextMenuItems(buildItems(res.data));
      });
    }
  };

  const onContextMenu = (e: React.MouseEvent, m: MessageSummary) => {
    const rect = new DOMRect(e.clientX, e.clientY, 0, 0);
    openContextMenu(e, buildMessageMenu({
      message: m,
      isOwn: bot?.id === m.authorId,
      ...(onReply ? { onReply: () => onReply(m) } : {}),
      onEdit: () => startEdit(m),
      onAddReaction: () => setReactState({ message: m, rect }),
      onGenerateClaudeReply: () => generateReplyWithClaude(m.channelId, m.id, m.authorDisplayName ?? m.authorTag),
    }));
  };

  const onPickReaction = async (token: string) => {
    if (!reactState) return;
    const custom = /^<(a?):([^:]+):(\d+)>$/.exec(token);
    const emoji = custom
      ? { id: custom[3]!, name: custom[2]!, animated: custom[1] === 'a' }
      : { id: null, name: token, animated: false };
    await api.messages.toggleReaction(reactState.message.channelId, reactState.message.id, emoji);
    setReactState(null);
  };

  return (
    <div className={`${head.replyTo ? 'mt-6' : 'mt-4'} first:mt-2 px-4`}>
      {head.replyTo && <ReplyPreview replyTo={head.replyTo} onJump={onJumpToMessage} />}
      <div onContextMenu={(e) => onContextMenu(e, head)} className={`relative flex gap-4 -mx-4 px-4 py-0.5 group ${headHighlight}`}>
        <HoverActions
          message={head}
          isOwn={bot?.id === head.authorId}
          onReply={onReply}
          onEdit={() => startEdit(head)}
        />
        <div className="w-10 shrink-0 pt-0.5 cursor-pointer" onClick={(e) => openProfile(e, head.authorId)} onContextMenu={(e) => onAuthorContextMenu(e, head.authorId, head.authorDisplayName, head.authorTag)}>
          <Avatar
            src={head.authorAvatarUrl}
            alt=""
            className="w-10 h-10 rounded-full hover:shadow-lg transition-shadow"
            fallback={<div className="w-10 h-10 rounded-full bg-bg-input flex items-center justify-center text-xs font-semibold text-fg">{head.authorDisplayName.slice(0, 2).toUpperCase()}</div>}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div data-message-id={head.id}>
            <div className="flex items-baseline gap-2 whitespace-nowrap">
              <span
                className="font-medium text-[15px] truncate cursor-pointer hover:underline"
                style={head.authorRoleColor ? { color: head.authorRoleColor } : undefined}
                title={head.authorTopRoleName ? `@${head.authorTag} · ${head.authorTopRoleName}` : `@${head.authorTag}`}
                onClick={(e) => openProfile(e, head.authorId)}
                onContextMenu={(e) => onAuthorContextMenu(e, head.authorId, head.authorDisplayName, head.authorTag)}
              >{head.authorDisplayName}</span>
              {(() => {
                const top = head.authorRoleIcons?.[0];
                if (!top) return null;
                return top.iconUrl
                  ? <img src={top.iconUrl} alt={top.roleName} title={top.roleName} className="w-[18px] h-[18px] object-contain shrink-0 self-center" />
                  : <span title={top.roleName} className="text-[16px] leading-none shrink-0 self-center">{top.unicodeEmoji}</span>;
              })()}
              <span className="text-[11px] text-fg-dim shrink-0">{formatHeaderTimestamp(head.createdAt)}</span>
            </div>
            {renderBody(head)}
          </div>
        </div>
      </div>
      {thinkingSet.has(head.id) && <MessageThinkingIndicator />}
      {messages.slice(1).map(m => (
        <div key={m.id}>
          <div
            data-message-id={m.id}
            onContextMenu={(e) => onContextMenu(e, m)}
            className={`relative flex gap-4 -mx-4 px-4 py-0.5 group ${mentionsBot(m, bot?.id) ? MENTION_ROW : 'hover:bg-hover/40'}`}
          >
            <HoverActions
              message={m}
              isOwn={bot?.id === m.authorId}
              onReply={onReply}
              onEdit={() => startEdit(m)}
            />
            <div className="w-10 shrink-0 text-[10px] text-fg-dim text-right pr-1 opacity-0 group-hover:opacity-100 leading-[21px] whitespace-nowrap tracking-tight">
              {formatGutterTimestamp(m.createdAt)}
            </div>
            <div className="flex-1 min-w-0">
              {renderBody(m)}
            </div>
          </div>
          {thinkingSet.has(m.id) && <MessageThinkingIndicator />}
        </div>
      ))}
      {reactState && (
        <EmojiPicker
          guildEmojis={guildEmojis}
          onSelect={onPickReaction}
          onClose={() => setReactState(null)}
          anchorRect={reactState.rect}
        />
      )}
      {profileState && (
        <UserProfileCard
          guildId={profileState.guildId}
          userId={profileState.userId}
          anchorRect={profileState.rect}
          onClose={() => setProfileState(null)}
        />
      )}
      {modState && head.guildId && modState.kind === 'kick'    && <KickDialog    guildId={head.guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
      {modState && head.guildId && modState.kind === 'ban'     && <BanDialog     guildId={head.guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
      {modState && head.guildId && modState.kind === 'timeout' && <TimeoutDialog guildId={head.guildId} userId={modState.userId} displayName={modState.displayName} onClose={() => setModState(null)} />}
      {embedEdit && (
        <EmbedModal
          channelId={embedEdit.channelId}
          guildId={embedEdit.guildId}
          channelName={embedEdit.channelId}
          edit={{ messageId: embedEdit.id }}
          initialMessage={{ content: embedEdit.content, embed: embedEdit.embeds[0]!, attachments: embedEdit.attachments }}
          onClose={() => setEmbedEdit(null)}
        />
      )}
    </div>
  );
}

function ReplyPreview({ replyTo, onJump }: { replyTo: NonNullable<MessageSummary['replyTo']>; onJump?: ((id: string) => void) | undefined }) {
  const clickable = Boolean(onJump);
  return (
    <div className="relative flex items-center gap-1.5 pl-[60px] pr-4 pt-1 mb-1 text-[13px] text-fg-muted">
      {/* Discord-style elbow line: vertical from avatar top, curving right into the preview. */}
      <span
        aria-hidden
        className="absolute left-[20px] top-[13px] bottom-[-16px] w-[24px] border-l-[2.5px] border-t-[2.5px] border-white/[0.12] rounded-tl-[6px]"
      />
      {/* Reply arrow at the end of the elbow */}
      <IconArrowRight aria-hidden size={12} className="absolute left-[46px] top-[8px] text-ok z-10" />
      <button
        type="button"
        onClick={clickable ? () => onJump!(replyTo.id) : undefined}
        disabled={!clickable}
        title={clickable ? 'Jump to message' : undefined}
        className={`flex items-center gap-1.5 min-w-0 text-left ${clickable ? 'cursor-pointer hover:text-fg' : ''}`}
      >
        {replyTo.authorAvatarUrl && (
          <img src={replyTo.authorAvatarUrl} alt="" className="w-4 h-4 rounded-full shrink-0" />
        )}
        <span
          className="font-medium shrink-0 truncate max-w-[12rem]"
          style={replyTo.authorRoleColor ? { color: replyTo.authorRoleColor } : undefined}
        >
          @{replyTo.authorDisplayName ?? 'unknown'}
        </span>
        <span className="text-fg-dim truncate min-w-0 leading-tight group-hover:text-fg">
          {replyTo.content
            ? <Markdown source={replyTo.content.split('\n')[0]!.slice(0, 200)} mentions={replyTo.mentions ?? []} jumbo={false} />
            : (replyTo.authorDisplayName ? '' : 'Original message')}
        </span>
      </button>
    </div>
  );
}

function HoverActions({
  message, isOwn, onReply, onEdit,
}: {
  message: MessageSummary;
  isOwn: boolean;
  onReply?: ((m: MessageSummary) => void) | undefined;
  onEdit?: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useExclusivePopover();
  const [menuOpen, setMenuOpen] = useExclusivePopover();
  const guildEmojis = useGuildEmojis(pickerOpen ? message.guildId : null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pickerSide, setPickerSide] = useState<'topRight' | 'bottomRight'>('topRight');

  // On open, measure the trigger's viewport position and flip the picker
  // above the message if there isn't enough room beneath it.
  useLayoutEffect(() => {
    if (!pickerOpen) return;
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < PICKER_HEIGHT && spaceAbove > spaceBelow) {
      setPickerSide('bottomRight');
    } else {
      setPickerSide('topRight');
    }
  }, [pickerOpen]);

  // Parse a Composer-style emoji token back into the structured form the
  // reaction IPC expects. EmojiPicker emits unicode chars or `<:name:id>` /
  // `<a:name:id>` for custom emoji.
  const handlePick = async (token: string) => {
    setPickerOpen(false);
    const custom = /^<(a?):([^:]+):(\d+)>$/.exec(token);
    const emoji = custom
      ? { id: custom[3]!, name: custom[2]!, animated: custom[1] === 'a' }
      : { id: null, name: token, animated: false };
    await api.messages.toggleReaction(message.channelId, message.id, emoji);
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    if (!window.confirm('Delete this message?')) return;
    const res = await api.messages.delete(message.channelId, message.id);
    if (!res.ok) pushToast('danger', `Couldn't delete: ${res.error.message}`);
  };

  // Force the actions container visible while either popover is open so a
  // moving mouse doesn't dismiss its anchor.
  const visibility = pickerOpen || menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100';

  return (
    <div className={`absolute -top-3 right-4 ${visibility} z-10 flex`}>
      <div className="bg-bg-subtle border border-white/[0.06] rounded shadow-lg flex">
        <button
          ref={triggerRef}
          onClick={() => setPickerOpen(!pickerOpen)}
          className={`w-8 h-8 flex items-center justify-center hover:bg-hover rounded ${pickerOpen ? 'text-fg' : 'text-fg-muted hover:text-fg'}`}
          title="Add reaction"
        >
          <IconMoodPlus size={18} stroke={1.75} />
        </button>
        {onReply && (
          <button
            onClick={() => onReply(message)}
            className="w-8 h-8 flex items-center justify-center text-fg-muted hover:text-fg hover:bg-hover rounded"
            title="Reply"
          >
            <IconCornerUpLeft size={18} stroke={1.75} className="scale-x-[-1]" />
          </button>
        )}
        <button
          onClick={() => generateReplyWithClaude(message.channelId, message.id, message.authorDisplayName ?? message.authorTag)}
          className="w-8 h-8 flex items-center justify-center text-fg-muted hover:text-fg hover:bg-hover rounded"
          title="Generate reply with Claude"
        >
          <IconSparkles size={18} stroke={1.75} />
        </button>
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className={`w-8 h-8 flex items-center justify-center hover:bg-hover rounded ${menuOpen ? 'text-fg' : 'text-fg-muted hover:text-fg'}`}
            title="More"
          >
            <IconDots size={18} stroke={1.75} />
          </button>
          {menuOpen && (
            <MoreMenu
              isOwn={isOwn}
              onClose={() => setMenuOpen(false)}
              onEdit={() => { setMenuOpen(false); onEdit?.(); }}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>
      {pickerOpen && (
        <EmojiPicker
          guildEmojis={guildEmojis}
          onSelect={handlePick}
          onClose={() => setPickerOpen(false)}
          position={pickerSide}
          ignoreRef={triggerRef}
        />
      )}
    </div>
  );
}

function MoreMenu({
  isOwn, onClose, onEdit, onDelete,
}: {
  isOwn: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // `null` until measured to avoid a flash on the wrong side. Flipping up
  // anchors to the trigger's top instead of its bottom when the viewport
  // doesn't have room below — mirrors the EmojiPicker behaviour.
  const [flipUp, setFlipUp] = useState<boolean | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    setFlipUp(rect.bottom + margin > window.innerHeight);
  }, []);

  const positionClass = flipUp === null
    ? 'top-full mt-1 invisible'
    : flipUp
      ? 'bottom-full mb-1 origin-bottom-right'
      : 'top-full mt-1 origin-top-right';
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div ref={ref} className={`absolute right-0 ${positionClass} z-50 min-w-[140px] bg-bg-subtle border border-white/[0.08] rounded-md shadow-2xl py-1 animate-fade-in-down`}>
        {isOwn && (
          <button
            onClick={onEdit}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-fg hover:bg-hover transition-colors"
          >
            <IconPencil size={14} stroke={1.75} className="text-fg-muted" />
            Edit
          </button>
        )}
        <button
          onClick={onDelete}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-danger hover:bg-danger/10 transition-colors"
        >
          <IconTrash size={14} stroke={1.75} />
          Delete
        </button>
      </div>
    </>
  );
}

// Inline editor that swaps in for MessageContent while editing. Submits on
// Enter (Shift+Enter for newline) and cancels on Escape, matching Discord.
function MessageEditor({ message, onDone }: { message: MessageSummary; onDone: () => void }) {
  const [text, setText] = useState(message.content);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Place caret at end and grow to fit content.
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const save = async () => {
    const next = text;
    if (next === message.content) { onDone(); return; }
    if (next.trim().length === 0) {
      // Empty edit is a delete in Discord; we surface it explicitly.
      if (!window.confirm('Empty content — delete this message instead?')) return;
      setBusy(true);
      const res = await api.messages.delete(message.channelId, message.id);
      setBusy(false);
      if (!res.ok) { pushToast('danger', `Couldn't delete: ${res.error.message}`); return; }
      onDone();
      return;
    }
    setBusy(true);
    const res = await api.messages.edit(message.channelId, message.id, next);
    setBusy(false);
    if (!res.ok) { pushToast('danger', `Couldn't edit: ${res.error.message}`); return; }
    onDone();
  };

  return (
    <div className="space-y-1">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => { setText(e.target.value); grow(); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onDone(); }
          else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save(); }
        }}
        disabled={busy}
        rows={1}
        spellCheck
        className="w-full bg-bg-input border border-white/[0.08] rounded-md px-3 py-2 text-[15px] leading-[1.375] text-fg outline-none focus:border-accent resize-none"
      />
      <div className="text-[11px] text-fg-dim">
        escape to <button onClick={onDone} className="text-link hover:underline">cancel</button>
        {' · '}
        enter to <button onClick={() => void save()} className="text-link hover:underline">save</button>
      </div>
    </div>
  );
}
