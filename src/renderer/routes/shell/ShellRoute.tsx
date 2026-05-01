import { useEffect, useRef, useState } from 'react';
import { ServerRail } from '../../components/ServerRail';
import { ChannelList } from '../../components/ChannelList';
import { BotIdentityFooter } from '../../components/BotIdentityFooter';
import { SettingsOverlay } from '../../components/settings/SettingsOverlay';
import { Toaster } from '../../components/Toaster';
import { ChannelView } from './ChannelView';
import { ForumView } from './ForumView';
import { MembersDirectory } from '../../components/MembersDirectory';
import { api } from '../../lib/api';
import { useUnreads } from '../../lib/use-unreads';
import type { ChannelSummary, GuildSummary } from '../../../shared/domain';
import { IconChevronDown } from '@tabler/icons-react';

type ForumPostRef = { postId: string; postName: string; forumId: string; forumName: string };
type View = { kind: 'channel'; channelId: string | null } | { kind: 'members' };

export function ShellRoute() {
  const [guild, setGuild] = useState<GuildSummary | null>(null);
  const [view, setView] = useState<View>({ kind: 'channel', channelId: null });
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [forumPostRef, setForumPostRef] = useState<ForumPostRef | null>(null);
  const lastViewByGuild = useRef<Map<string, View>>(new Map());

  useEffect(() => {
    if (!guild) { setChannels([]); return; }
    api.guilds.listChannels(guild.id).then(res => { if (res.ok) setChannels(res.data); });
  }, [guild]);

  const channelId = view.kind === 'channel' ? view.channelId : null;
  const selectedChannel = channels.find(c => c.id === channelId) ?? null;
  const channelName = selectedChannel?.name
    ?? (forumPostRef && forumPostRef.postId === channelId ? forumPostRef.postName : null);
  const unreads = useUnreads(channelId);

  // Mirror unread state to the system-tray icon (red dot in top-right
  // when any unmuted channel has fresh content the user hasn't seen).
  useEffect(() => {
    void api.tray.setUnreadBadge(unreads.channelIds.size > 0);
  }, [unreads.channelIds.size]);

  const parentChannel = selectedChannel?.parentId
    ? channels.find(c => c.id === selectedChannel.parentId) ?? null
    : null;
  const backToForum = selectedChannel?.type === 'thread' && parentChannel?.type === 'forum'
    ? { id: parentChannel.id, name: parentChannel.name, onClick: () => { setForumPostRef(null); setView({ kind: 'channel', channelId: parentChannel.id }); } }
    : forumPostRef && forumPostRef.postId === channelId
      ? { id: forumPostRef.forumId, name: forumPostRef.forumName, onClick: () => { setForumPostRef(null); setView({ kind: 'channel', channelId: forumPostRef.forumId }); } }
      : undefined;

  const setChannelView = (id: string | null) => { setForumPostRef(null); setView({ kind: 'channel', channelId: id }); };
  const setMembersView = () => setView({ kind: 'members' });

  return (
    <div className="h-full flex bg-bg-sunken">
      <aside className="w-[64px] shrink-0 min-h-0">
        <ServerRail
          selected={guild?.id ?? null}
          onSelect={(g) => {
            if (guild) lastViewByGuild.current.set(guild.id, view);
            setGuild(g);
            const remembered = lastViewByGuild.current.get(g.id);
            setView(remembered ?? { kind: 'channel', channelId: null });
            setForumPostRef(null);
          }}
          unreadGuildIds={unreads.guildIds}
          mentionGuildIds={unreads.mentionGuildIds}
          mentionGuildCounts={unreads.mentionGuildCounts}
          onMarkRead={unreads.markGuildRead}
        />
      </aside>
      <aside className="w-[310px] shrink-0 min-h-0 bg-bg-sunken flex flex-col rounded-tl-xl border-t border-l border-white/[0.04] overflow-hidden">
        <div className="h-12 px-4 flex items-center justify-between border-b border-white/[0.04] shrink-0">
          <span className="font-semibold text-fg text-[15px] truncate">{guild?.name ?? 'BotCord'}</span>
          <IconChevronDown size={18} stroke={2} className="text-fg-muted shrink-0 ml-2" />
        </div>
        <div className="flex-1 min-h-0">
          <ChannelList
            guildId={guild?.id ?? null}
            selected={channelId}
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
          channelId={channelId}
          guildId={guild?.id ?? null}
          channelName={channelName}
          {...(backToForum ? { backToForum } : {})}
        />
      )}
      {settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} />}
      <Toaster />
    </div>
  );
}
