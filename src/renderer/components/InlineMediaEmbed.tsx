import type { MessageEmbedSummary } from '../../shared/domain';
import { openLightbox } from './Lightbox';

/**
 * Render gifv/image/video embeds (Tenor, Giphy, bare image links) as the
 * media itself rather than a card. For gifv/video we prefer the gif
 * thumbnail (animated) over the mp4 since it loops without controls
 * out of the box.
 */
export function InlineMediaEmbed({ embed }: { embed: MessageEmbedSummary }) {
  const isVideo = embed.type === 'video';
  const videoUrl = isVideo && embed.video?.url ? embed.video.url : null;
  const imageUrl = embed.thumbnail?.url ?? embed.image?.url ?? null;

  if (videoUrl) {
    return (
      <video
        src={videoUrl}
        controls
        loop
        muted
        playsInline
        className="rounded border border-border max-w-md max-h-96"
        poster={imageUrl ?? undefined}
      />
    );
  }

  if (!imageUrl) return null;
  return (
    <button onClick={() => openLightbox(imageUrl)} className="block">
      <img
        src={imageUrl}
        alt=""
        className="rounded border border-border max-w-md max-h-96 cursor-zoom-in"
      />
    </button>
  );
}
