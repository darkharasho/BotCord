import { useEffect, useRef, useState } from 'react';
import { ServerRail } from '../../components/ServerRail';
import { ChannelList } from '../../components/ChannelList';
import { BotIdentityFooter } from '../../components/BotIdentityFooter';
import { SettingsPanel } from '../../components/SettingsPanel';
import { Toaster } from '../../components/Toaster';
import { ChannelView } from './ChannelView';
import { ForumView } from './ForumView';
import { api } from '../../lib/api';
import { useUnreads } from '../../lib/use-unreads';
import type { ChannelSummary, GuildSummary } from '../../../shared/domain';
import { IconChevronDown } from '@tabler/icons-react';

type ForumPostRef = { postId: string; postName: string; forumId: string; forumName: string };

export function ShellRoute() {
  const [guild, setGuild] = useState<GuildSummary | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [forumPostRef, setForumPostRef] = useState<ForumPostRef | null>(null);
  const lastChannelByGuild = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!guild) { setChannels([]); return; }
    api.guilds.listChannels(guild.id).then(res => { if (res.ok) setChannels(res.data); });
  }, [guild]);

  const selectedChannel = channels.find(c => c.id === channelId) ?? null;
  const channelName = selectedChannel?.name
    ?? (forumPostRef && forumPostRef.postId === channelId ? forumPostRef.postName : null);
  const unreads = useUnreads(channelId);

  // Surface a back-to-forum breadcrumb when viewing a forum post.
  // First try the channels cache; fall back to the explicit forumPostRef
  // which covers archived / inactive threads not present in the channel list.
  const parentChannel = selectedChannel?.parentId
    ? channels.find(c => c.id === selectedChannel.parentId) ?? null
    : null;
  const backToForum = selectedChannel?.type === 'thread' && parentChannel?.type === 'forum'
    ? { id: parentChannel.id, name: parentChannel.name, onClick: () => { setForumPostRef(null); setChannelId(parentChannel.id); } }
    : forumPostRef && forumPostRef.postId === channelId
      ? { id: forumPostRef.forumId, name: forumPostRef.forumName, onClick: () => { setForumPostRef(null); setChannelId(forumPostRef.forumId); } }
      : undefined;

  return (
    <div className="h-full flex bg-bg-sunken">
      <aside className="w-[64px] shrink-0 min-h-0">
        <ServerRail
          selected={guild?.id ?? null}
          onSelect={(g) => {
            if (guild && channelId) lastChannelByGuild.current.set(guild.id, channelId);
            setGuild(g);
            setChannelId(lastChannelByGuild.current.get(g.id) ?? null);
            setForumPostRef(null);
          }}
          unreadGuildIds={unreads.guildIds}
        />
      </aside>
      <aside className="w-[310px] shrink-0 min-h-0 bg-bg-sunken flex flex-col rounded-tl-xl border-t border-l border-white/[0.04] overflow-hidden">
        <div className="h-12 px-4 flex items-center justify-between border-b border-white/[0.04] shrink-0">
          <span className="font-semibold text-fg text-[15px] truncate">{guild?.name ?? 'BotCord'}</span>
          <IconChevronDown size={18} stroke={2} className="text-fg-muted shrink-0 ml-2" />
        </div>
        <div className="flex-1 min-h-0">
          <ChannelList guildId={guild?.id ?? null} selected={channelId} onSelect={(id) => { setForumPostRef(null); setChannelId(id); }} unreadIds={unreads.channelIds} />
        </div>
        <BotIdentityFooter onOpenSettings={() => setSettingsOpen(true)} />
      </aside>
      {selectedChannel?.type === 'forum' ? (
        <ForumView
          guildId={guild?.id ?? null}
          forumId={selectedChannel.id}
          forumName={selectedChannel.name}
          onSelectPost={(postId, postName) => {
            setForumPostRef({ postId, postName, forumId: selectedChannel.id, forumName: selectedChannel.name });
            setChannelId(postId);
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
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      <Toaster />
    </div>
  );
}
