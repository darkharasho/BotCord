import type { MessageSummary, MessageEmbedSummary } from '../../shared/domain';
import { Markdown } from './Markdown';
import { EmbedCard } from './EmbedCard';
import { InlineMediaEmbed } from './InlineMediaEmbed';
import { AttachmentInline } from './AttachmentInline';
import { PollCard } from './PollCard';
import { ReactionBar } from './ReactionBar';

function isMediaOnlyEmbed(e: MessageEmbedSummary): boolean {
  // Tenor/Giphy and bare image/gif links arrive as type=gifv|image|video.
  // Need a renderable media URL.
  const hasMedia = !!(e.image?.url || e.thumbnail?.url || e.video?.url);
  if (!hasMedia) return false;
  // Animated/video embeds: always inline (Giphy includes a title; we still
  // want to show the GIF, not a card).
  if (e.type === 'gifv' || e.type === 'video') return true;
  // Static image embeds: only inline if there's no descriptive content
  // (otherwise it's a rich card with an image, like a website preview).
  if (e.type === 'image') {
    return !e.title && !e.description && e.fields.length === 0 && !e.author && !e.footer;
  }
  return false;
}

/**
 * Suppress the message text when it's purely the source URL of a media-only
 * embed (e.g. user posts a single Tenor link — Discord hides the link too).
 */
function shouldHideContent(content: string, embeds: MessageEmbedSummary[]): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (embeds.length === 0) return false;
  if (!embeds.every(isMediaOnlyEmbed)) return false;
  const sourceUrls = new Set(embeds.map(e => e.url).filter((u): u is string => !!u));
  if (sourceUrls.size === 0) return false;
  // Split on whitespace; if every token is a source URL we can hide.
  const tokens = trimmed.split(/\s+/);
  return tokens.every(t => sourceUrls.has(t));
}

export function MessageContent({ message }: { message: MessageSummary }) {
  const hideContent = shouldHideContent(message.content, message.embeds);
  return (
    <div className="space-y-0.5">
      {message.content && !hideContent && (
        <div className="text-[15px] leading-[1.375] text-fg whitespace-pre-wrap break-words">
          <Markdown source={message.content} mentions={message.mentions} />
          {message.editedAt && <span className="text-fg-dim text-[10px] ml-1">(edited)</span>}
        </div>
      )}
      {message.attachments.map(a => <AttachmentInline key={a.id} attachment={a} />)}
      {message.embeds.map((e, i) =>
        isMediaOnlyEmbed(e)
          ? <InlineMediaEmbed key={i} embed={e} />
          : <EmbedCard key={i} embed={e} mentions={message.mentions} />
      )}
      {message.poll && <PollCard poll={message.poll} channelId={message.channelId} messageId={message.id} mentions={message.mentions} />}
      <ReactionBar message={message} />
    </div>
  );
}
