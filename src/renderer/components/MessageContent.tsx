import type { MessageSummary } from '../../shared/domain';
import { Markdown } from './Markdown';
import { EmbedCard } from './EmbedCard';
import { AttachmentInline } from './AttachmentInline';

export function MessageContent({ message }: { message: MessageSummary }) {
  return (
    <div className="space-y-1">
      {message.content && (
        <div className="text-sm text-fg whitespace-pre-wrap break-words">
          <Markdown source={message.content} mentions={message.mentions} />
          {message.editedAt && <span className="text-fg-muted text-[10px] ml-1">(edited)</span>}
        </div>
      )}
      {message.attachments.map(a => <AttachmentInline key={a.id} attachment={a} />)}
      {message.embeds.map((e, i) => <EmbedCard key={i} embed={e} />)}
    </div>
  );
}
