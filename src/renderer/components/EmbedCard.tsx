import type { MessageEmbedSummary } from '../../shared/domain';
import { Markdown } from './Markdown';

const openExternal = (url: string) => window.botcord.system.openExternal(url);

function formatEmbedTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `Today at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' })
    + ' '
    + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function EmbedCard({ embed }: { embed: MessageEmbedSummary }) {
  const accent = embed.color != null
    ? `#${embed.color.toString(16).padStart(6, '0')}`
    : '#202225';

  // Discord floats the thumbnail top-right when there's a thumbnail but no separate image.
  const hasFloatedThumb = !!embed.thumbnail && !embed.image;

  return (
    <div
      className="my-1 max-w-[520px] rounded bg-bg-subtle/60 grid"
      style={{
        borderLeft: `4px solid ${accent}`,
        gridTemplateColumns: hasFloatedThumb ? 'minmax(0,1fr) auto' : 'minmax(0,1fr)',
      }}
    >
      <div className="px-3 py-2 min-w-0 space-y-1">
        {embed.provider?.name && (
          <div className="text-[11px] text-fg-muted">
            {embed.provider.url
              ? <a href="#" onClick={(e) => { e.preventDefault(); openExternal(embed.provider!.url!); }} className="hover:underline">{embed.provider.name}</a>
              : embed.provider.name}
          </div>
        )}

        {embed.author && (
          <div className="flex items-center gap-2">
            {embed.author.iconUrl && (
              <img src={embed.author.iconUrl} alt="" className="w-6 h-6 rounded-full shrink-0" />
            )}
            <div className="text-[14px] font-semibold text-fg truncate">
              {embed.author.url
                ? <a href="#" onClick={(e) => { e.preventDefault(); openExternal(embed.author!.url!); }} className="hover:underline">{embed.author.name}</a>
                : embed.author.name}
            </div>
          </div>
        )}

        {embed.title && (
          <div className="text-[15px] font-semibold leading-snug">
            {embed.url
              ? <a href="#" onClick={(e) => { e.preventDefault(); openExternal(embed.url!); }} className="text-accent hover:underline">{embed.title}</a>
              : <span className="text-fg">{embed.title}</span>}
          </div>
        )}

        {embed.description && (
          <div className="text-[14px] text-fg whitespace-pre-wrap leading-snug">
            <Markdown source={embed.description} />
          </div>
        )}

        {embed.fields.length > 0 && (
          <div className="grid grid-cols-6 gap-2 mt-1">
            {embed.fields.map((f, i) => (
              <div key={i} className={f.inline ? 'col-span-3 min-w-0' : 'col-span-6'}>
                <div className="text-[13px] font-semibold text-fg">{f.name}</div>
                <div className="text-[13px] text-fg-muted whitespace-pre-wrap leading-snug">
                  <Markdown source={f.value} />
                </div>
              </div>
            ))}
          </div>
        )}

        {embed.image && (
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); openExternal(embed.image!.url); }}
            className="block mt-1"
          >
            <img
              src={embed.image.url}
              alt=""
              className="rounded max-w-full max-h-[400px] object-contain"
            />
          </a>
        )}

        {embed.video && embed.video.url && !embed.image && (
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); openExternal(embed.video!.url); }}
            className="block mt-1 text-xs text-accent hover:underline"
          >
            ▶ Open video
          </a>
        )}

        {(embed.footer || embed.timestamp) && (
          <div className="flex items-center gap-2 mt-2 text-[12px] text-fg-muted">
            {embed.footer?.iconUrl && (
              <img src={embed.footer.iconUrl} alt="" className="w-4 h-4 rounded-full shrink-0" />
            )}
            <span className="truncate">
              {embed.footer?.text}
              {embed.footer?.text && embed.timestamp && <span className="mx-1.5 text-fg-dim">•</span>}
              {embed.timestamp && formatEmbedTimestamp(embed.timestamp)}
            </span>
          </div>
        )}
      </div>

      {hasFloatedThumb && embed.thumbnail && (
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); openExternal(embed.thumbnail!.url); }}
          className="p-2 self-start"
        >
          <img
            src={embed.thumbnail.url}
            alt=""
            className="rounded max-w-[80px] max-h-[80px] object-cover"
          />
        </a>
      )}
    </div>
  );
}
