import { useEffect, useState } from 'react';

const ANIMATED_PLAY_MS = 3000;

function isAnimated(url: string | null | undefined): boolean {
  return !!url && /\.gif(\?|$)/.test(url);
}

function toStaticAvatar(url: string): string {
  // Discord serves the same avatar as gif/webp/png. Swapping .gif → .webp
  // returns the first-frame static version. Querystring (`?size=64` etc.)
  // is preserved.
  return url.replace(/\.gif(\?|$)/, '.webp$1');
}

// Avatar that mirrors the ServerRail behavior for animated guild icons:
// animated GIFs play once for ~3s on mount, then freeze on the first frame
// by swapping to the static .webp. Hovering replays the animation.
export function Avatar({
  src, alt = '', className, fallback,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [playOnMount, setPlayOnMount] = useState(true);

  useEffect(() => {
    if (!isAnimated(src)) return;
    const t = setTimeout(() => setPlayOnMount(false), ANIMATED_PLAY_MS);
    return () => clearTimeout(t);
  }, [src]);

  if (!src) return <>{fallback ?? null}</>;

  const animated = isAnimated(src);
  const playing = animated && (hovered || playOnMount);
  const resolvedSrc = animated && !playing ? toStaticAvatar(src) : src;

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      draggable={false}
    />
  );
}
