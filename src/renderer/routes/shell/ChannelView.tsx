import { MessageList } from '../../components/MessageList';
import { Composer } from '../../components/Composer';

export function ChannelView({ channelId, guildId, channelName }: { channelId: string | null; guildId: string | null; channelName: string | null }) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="h-10 border-b border-border flex items-center px-4 bg-bg-subtle shrink-0">
        <span className="text-fg-muted text-sm mr-1">#</span>
        <span className="font-semibold text-sm">{channelName ?? 'Select a channel'}</span>
      </div>
      <MessageList channelId={channelId} />
      <Composer channelId={channelId} guildId={guildId} />
    </div>
  );
}
