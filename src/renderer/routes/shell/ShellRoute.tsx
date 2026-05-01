import { useEffect, useRef, useState } from 'react';
import { ServerRail } from '../../components/ServerRail';
import { ChannelList } from '../../components/ChannelList';
import { BotIdentityFooter } from '../../components/BotIdentityFooter';
import { SettingsOverlay } from '../../components/settings/SettingsOverlay';
import { Toaster } from '../../components/Toaster';
import { ChannelView } from './ChannelView';
import { ForumView } from './ForumView';
import { MembersDirectory } from '../../components/MembersDirectory';
import { DMList } from '../../components/DMList';
import { MessageList } from '../../components/MessageList';
import { Composer } from '../../components/Composer';
import { WelcomePane } from '../../components/WelcomePane';
import { Avatar } from '../../components/Avatar';
import { api } from '../../lib/api';
import { useUnreads } from '../../lib/use-unreads';
import { useDMNotifications } from '../../lib/use-dm-notifications';
import type { ChannelSummary, DMChannelRow, GuildSummary } from '../../../shared/domain';
import { IconChevronDown } from '@tabler/icons-react';

type ForumPostRef = { postId: string; postName: string; forumId: string; forumName: string };
type View = { kind: 'channel'; channelId: string | null } | { kind: 'members' };
type ShellView = 'home' | 'guild';

export function ShellRoute() {
  const [shellView, setShellView] = useState<ShellView>('guild');
  const [guild, setGuild] = useState<GuildSummary | null>(null);
  const [view, setView] = useState<View>({ kind: 'channel', channelId: null });
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [forumPostRef, setForumPostRef] = useState<ForumPostRef | null>(null);
  const lastViewByGuild = useRef<Map<string, View>>(new Map());

  // Home / DMs state
  const [activeDMChannelId, setActiveDMChannelId] = useState<string | null>(null);
  const [dmRows, setDMRows] = useState<DMChannelRow[]>([]);

  // Window focus tracking — used to suppress DM notifications when the DM is
  // already on screen with the window in front.
  const [windowFocused, setWindowFocused] = useState(
    typeof document !== 'undefined' ? document.hasFocus() : true,
  );
  useEffect(() => {
    const onFocus = () => setWindowFocused(true);
    const onBlur = () => setWindowFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    if (!guild) { setChannels([]); return; }
    api.guilds.listChannels(guild.id).then(res => { if (res.ok) setChannels(res.data); });
  }, [guild]);

  // Maintain a local cache of DM rows so the DM header can render avatar +
  // names without re-fetching. Refresh on inbound DM messageCreate.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      api.dms.list().then(res => { if (!cancelled && res.ok) setDMRows(res.data); });
    };
    refresh();
    const off = api.events.onMessageCreate(({ message }) => {
      if (message.guildId) return;
      refresh();
    });
    return () => { cancelled = true; off(); };
  }, []);

  const guildChannelId = view.kind === 'channel' ? view.channelId : null;
  const selectedChannel = channels.find(c => c.id === guildChannelId) ?? null;
  const channelName = selectedChannel?.name
    ?? (forumPostRef && forumPostRef.postId === guildChannelId ? forumPostRef.postName : null);

  // The "active" channel for unread bookkeeping depends on which surface
  // the user is currently looking at. In Home the active channel is the
  // selected DM; in Guild it's the selected guild channel.
  const activeChannelIdForUnreads = shellView === 'home' ? activeDMChannelId : guildChannelId;
  const unreads = useUnreads(activeChannelIdForUnreads);

  // Mirror unread state to the system-tray icon (red dot in top-right
  // when any unmuted channel has fresh content the user hasn't seen).
  useEffect(() => {
    void api.tray.setUnreadBadge(unreads.channelIds.size > 0);
  }, [unreads.channelIds.size]);

  // Read the DM-notification preference (default true).
  const [notifyOnDM, setNotifyOnDM] = useState(true);
  useEffect(() => {
    api.prefs.get('notifyOnDM').then(r => {
      if (r.ok && typeof r.data === 'boolean') setNotifyOnDM(r.data);
    });
  }, []);

  useDMNotifications({
    enabled: notifyOnDM,
    isWindowFocused: windowFocused,
    isHomeViewActive: shellView === 'home',
    activeDMChannelId,
    onClickGotoDM: (id) => {
      window.focus();
      setShellView('home');
      setActiveDMChannelId(id);
    },
  });

  const parentChannel = selectedChannel?.parentId
    ? channels.find(c => c.id === selectedChannel.parentId) ?? null
    : null;
  const backToForum = selectedChannel?.type === 'thread' && parentChannel?.type === 'forum'
    ? { id: parentChannel.id, name: parentChannel.name, onClick: () => { setForumPostRef(null); setView({ kind: 'channel', channelId: parentChannel.id }); } }
    : forumPostRef && forumPostRef.postId === guildChannelId
      ? { id: forumPostRef.forumId, name: forumPostRef.forumName, onClick: () => { setForumPostRef(null); setView({ kind: 'channel', channelId: forumPostRef.forumId }); } }
      : undefined;

  const setChannelView = (id: string | null) => { setForumPostRef(null); setView({ kind: 'channel', channelId: id }); };
  const setMembersView = () => setView({ kind: 'members' });

  const activeDMRow = activeDMChannelId
    ? dmRows.find(r => r.channelId === activeDMChannelId) ?? null
    : null;

  return (
    <div className="h-full flex bg-bg-sunken">
      <aside className="w-[64px] shrink-0 min-h-0">
        <ServerRail
          selected={shellView === 'guild' ? guild?.id ?? null : null}
          onSelect={(g) => {
            if (shellView === 'guild' && guild) lastViewByGuild.current.set(guild.id, view);
            setShellView('guild');
            setGuild(g);
            const remembered = lastViewByGuild.current.get(g.id);
            setView(remembered ?? { kind: 'channel', channelId: null });
            setForumPostRef(null);
          }}
          unreadGuildIds={unreads.guildIds}
          mentionGuildIds={unreads.mentionGuildIds}
          mentionGuildCounts={unreads.mentionGuildCounts}
          onMarkRead={unreads.markGuildRead}
          homeActive={shellView === 'home'}
          homeUnread={unreads.dmUnreadChannelIds.size > 0}
          homeMentionCount={unreads.dmMentionCount}
          onHomeClick={() => setShellView('home')}
        />
      </aside>
      {shellView === 'home' ? (
        <>
          <aside className="w-[310px] shrink-0 min-h-0 bg-bg-sunken flex flex-col rounded-tl-xl border-t border-l border-white/[0.04] overflow-hidden">
            <div className="h-12 px-4 flex items-center justify-between border-b border-white/[0.04] shrink-0">
              <span className="font-semibold text-fg text-[15px] truncate">Direct Messages</span>
            </div>
            <div className="flex-1 min-h-0">
              <DMList
                activeChannelId={activeDMChannelId}
                onSelect={(id) => setActiveDMChannelId(id)}
              />
            </div>
            <BotIdentityFooter onOpenSettings={() => setSettingsOpen(true)} />
          </aside>
          <div className="flex-1 flex flex-col min-h-0 bg-bg border-t border-l border-white/[0.04] overflow-hidden">
            {activeDMChannelId && activeDMRow ? (
              <>
                <DMHeader row={activeDMRow} />
                <MessageList channelId={activeDMChannelId} />
                <Composer channelId={activeDMChannelId} guildId={null} mode="dm" />
              </>
            ) : activeDMChannelId ? (
              // Have an id but the row hasn't loaded yet — render messages
              // and composer; header will appear once the row arrives.
              <>
                <MessageList channelId={activeDMChannelId} />
                <Composer channelId={activeDMChannelId} guildId={null} mode="dm" />
              </>
            ) : (
              <WelcomePane hasGuild={false} />
            )}
          </div>
        </>
      ) : (
        <>
          <aside className="w-[310px] shrink-0 min-h-0 bg-bg-sunken flex flex-col rounded-tl-xl border-t border-l border-white/[0.04] overflow-hidden">
            <div className="h-12 px-4 flex items-center justify-between border-b border-white/[0.04] shrink-0">
              <span className="font-semibold text-fg text-[15px] truncate">{guild?.name ?? 'BotCord'}</span>
              <IconChevronDown size={18} stroke={2} className="text-fg-muted shrink-0 ml-2" />
            </div>
            <div className="flex-1 min-h-0">
              <ChannelList
                guildId={guild?.id ?? null}
                selected={guildChannelId}
                onSelect={setChannelView}
                unreadIds={unreads.channelIds}
                mentionIds={unreads.mentionChannelIds}
                mutedIds={unreads.mutedChannelIds}
                onToggleMute={unreads.toggleMuted}
                view={view.kind}
                onSelectMembers={setMembersView}
                memberCount={guild?.memberCount ?? null}
              />
            </div>
            <BotIdentityFooter onOpenSettings={() => setSettingsOpen(true)} />
          </aside>
          {view.kind === 'members' ? (
            <MembersDirectory guildId={guild?.id ?? null} />
          ) : selectedChannel?.type === 'forum' ? (
            <ForumView
              guildId={guild?.id ?? null}
              forumId={selectedChannel.id}
              forumName={selectedChannel.name}
              onSelectPost={(postId, postName) => {
                setForumPostRef({ postId, postName, forumId: selectedChannel.id, forumName: selectedChannel.name });
                setView({ kind: 'channel', channelId: postId });
              }}
            />
          ) : (
            <ChannelView
              channelId={guildChannelId}
              guildId={guild?.id ?? null}
              channelName={channelName}
              {...(backToForum ? { backToForum } : {})}
            />
          )}
        </>
      )}
      {settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} />}
      <Toaster />
    </div>
  );
}

function DMHeader({ row }: { row: DMChannelRow }) {
  const displayName = row.userGlobalName ?? row.userUsername;
  return (
    <div className="h-12 flex items-center px-4 shrink-0 border-b border-white/[0.04] gap-3">
      <Avatar
        src={row.userAvatar}
        alt=""
        className="h-7 w-7 rounded-full"
        fallback={
          <div className="h-7 w-7 rounded-full bg-bg-input flex items-center justify-center text-[11px] font-semibold text-fg">
            {displayName.slice(0, 2).toUpperCase()}
          </div>
        }
      />
      <div className="min-w-0 flex flex-col leading-tight">
        <span className="truncate text-sm font-semibold text-fg">{displayName}</span>
        <span className="truncate text-[11px] text-fg-muted">{row.userUsername}</span>
      </div>
      <div className="flex-1" />
      <button
        type="button"
        disabled
        title="Profile view coming soon"
        className="rounded bg-bg-subtle px-2 py-1 text-xs text-fg-dim opacity-60 cursor-not-allowed"
      >
        View profile
      </button>
    </div>
  );
}
