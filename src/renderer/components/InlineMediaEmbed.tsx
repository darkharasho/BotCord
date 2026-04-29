import type { MessageEmbedSummary } from '../../shared/domain';
import { openLightbox } from './Lightbox';

/**
 * Render gifv/image/video embeds (Tenor, Giphy, bare image links) as the
 * media itself rather than a card.
 *
 * - gifv (Tenor/Giphy): Discord serves an mp4 in `video.url` that loops.
 *   Render via <video autoPlay loop muted> for that always-playing GIF
 *   experience. Fallback to thumbnail.url (a static frame) if no video.
 * - video: <video> with controls so the user can play/pause/scrub.
 * - image: just the image, click for lightbox.
 */
export function InlineMediaEmbed({ embed }: { embed: MessageEmbedSummary }) {
  const videoUrl = embed.video?.url ?? null;
  const thumb = embed.thumbnail?.url ?? embed.image?.url ?? null;

  if (embed.type === 'gifv' && videoUrl) {
    return (
      <video
        src={videoUrl}
        autoPlay
        loop
        muted
        playsInline
        className="rounded border border-border max-w-md max-h-96"
        poster={thumb ?? undefined}
      />
    );
  }

  if (embed.type === 'video' && videoUrl) {
    return (
      <video
        src={videoUrl}
        controls
        loop
        muted
        playsInline
        className="rounded border border-border max-w-md max-h-96"
        poster={thumb ?? undefined}
      />
    );
  }

  const imageUrl = embed.image?.url ?? embed.thumbnail?.url ?? null;
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
