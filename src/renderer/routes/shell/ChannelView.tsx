import { MessageList } from '../../components/MessageList';
import { Composer } from '../../components/Composer';

export function ChannelView({ channelId, guildId, channelName }: { channelId: string | null; guildId: string | null; channelName: string | null }) {
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg">
      <div className="h-12 flex items-center px-4 shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.2),0_1.5px_0_rgba(0,0,0,0.05),0_2px_0_rgba(0,0,0,0.05)] z-10">
        <span className="text-fg-dim text-xl mr-2 font-light">#</span>
        <span className="font-semibold text-fg text-base">{channelName ?? 'Select a channel'}</span>
      </div>
      <MessageList channelId={channelId} />
      <Composer channelId={channelId} guildId={guildId} />
    </div>
  );
}
