import type { MessageEmbedSummary } from '../../shared/domain';
import { Markdown } from './Markdown';

export function EmbedCard({ embed }: { embed: MessageEmbedSummary }) {
  const accent = embed.color != null
    ? `#${embed.color.toString(16).padStart(6, '0')}`
    : 'var(--tw-color-border, #2c2e36)';
  return (
    <div className="border-l-4 bg-bg-subtle/40 rounded p-3 max-w-2xl text-sm" style={{ borderLeftColor: accent }}>
      {embed.authorName && <div className="font-medium text-fg-muted mb-1">{embed.authorName}</div>}
      {embed.title && (
        embed.url
          ? <a href={embed.url} className="block font-semibold text-accent hover:underline" onClick={(e) => { e.preventDefault(); window.botcord.system.openExternal(embed.url!); }}>{embed.title}</a>
          : <div className="font-semibold">{embed.title}</div>
      )}
      {embed.description && (
        <div className="mt-1 text-fg whitespace-pre-wrap"><Markdown source={embed.description} /></div>
      )}
      {embed.fields.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mt-2">
          {embed.fields.map((f, i) => (
            <div key={i} className={f.inline ? '' : 'col-span-2'}>
              <div className="font-semibold text-xs">{f.name}</div>
              <div className="text-xs text-fg-muted whitespace-pre-wrap"><Markdown source={f.value} /></div>
            </div>
          ))}
        </div>
      )}
      {embed.image && <img src={embed.image} alt="" className="mt-2 rounded max-h-64" />}
      {embed.footerText && <div className="mt-2 text-[10px] text-fg-muted">{embed.footerText}</div>}
    </div>
  );
}
