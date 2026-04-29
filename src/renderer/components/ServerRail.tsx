import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { GuildSummary } from '../../shared/domain';
import { Tooltip } from './Tooltip';

const ANIMATED_PLAY_MS = 3000; // play once on mount for ~3s, then freeze on first frame

export function ServerRail({
  selected, onSelect, unreadGuildIds,
}: { selected: string | null; onSelect: (g: GuildSummary) => void; unreadGuildIds?: Set<string> }) {
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await api.guilds.list();
      if (!active) return;
      if (res.ok) { setGuilds(res.data); setError(null); }
      else setError(res.error.message);
    };
    load();
    const unsub = api.events.onGuildUpdate(() => load());
    const unsubGw = api.events.onGatewayState((s) => { if (s.status === 'ready') load(); });
    return () => { active = false; unsub(); unsubGw(); };
  }, []);

  return (
    <div
      className="h-full overflow-y-auto overflow-x-hidden pt-3 pb-3 flex flex-col items-center gap-2 bg-bg-sunken"
      style={{ scrollbarWidth: 'none' } as React.CSSProperties}
    >
      {error && <div className="text-danger text-[10px] px-1 text-center leading-tight">{error}</div>}
      {guilds.map(g => (
        <GuildRailItem
          key={g.id}
          guild={g}
          selected={selected === g.id}
          unread={!!unreadGuildIds?.has(g.id)}
          onSelect={onSelect}
        />
      ))}
      {guilds.length === 0 && !error && (
        <div className="text-fg-dim text-[10px] px-1 text-center">No guilds</div>
      )}
    </div>
  );
}

function GuildRailItem({
  guild, selected, unread, onSelect,
}: { guild: GuildSummary; selected: boolean; unread: boolean; onSelect: (g: GuildSummary) => void }) {
  const [hovered, setHovered] = useState(false);
  const [playOnMount, setPlayOnMount] = useState(true);

  // Animated icons play on mount for ANIMATED_PLAY_MS, then freeze on first frame
  // by swapping to the static webp. They play again whenever hovered.
  useEffect(() => {
    if (!isAnimated(guild.iconUrl)) return;
    const t = setTimeout(() => setPlayOnMount(false), ANIMATED_PLAY_MS);
    return () => clearTimeout(t);
  }, [guild.iconUrl]);

  const sideIndicator =
    selected
      ? 'h-10 opacity-100'
      : hovered
        ? 'h-5 opacity-100'
        : unread
          ? 'h-2 opacity-100'
          : 'h-0 opacity-0';

  const animated = isAnimated(guild.iconUrl);
  const shouldAnimate = animated && (hovered || playOnMount);
  const iconSrc = animated && !shouldAnimate ? toStaticIcon(guild.iconUrl!) : guild.iconUrl;

  return (
    <Tooltip label={guild.name} side="right">
      <button
        onClick={() => onSelect(guild)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative"
      >
        <span
          className={`absolute -left-3 top-1/2 -translate-y-1/2 w-1 bg-fg rounded-r transition-all duration-200 ease-out ${sideIndicator}`}
        />
        <div
          className={`w-12 h-12 rounded-2xl overflow-hidden bg-bg-subtle flex items-center justify-center text-sm font-semibold text-fg transition-colors duration-150
            ${selected ? 'bg-accent text-white' : 'hover:bg-accent hover:text-white'}`}
        >
          {iconSrc
            ? <img src={iconSrc} alt="" className="w-full h-full object-cover" />
            : guild.name.slice(0, 2).toUpperCase()}
        </div>
      </button>
    </Tooltip>
  );
}

function isAnimated(url: string | null): boolean {
  return !!url && /\.gif(\?|$)/.test(url);
}

function toStaticIcon(url: string): string {
  // Discord serves the same icon as gif/webp/png — swap the extension for the
  // first-frame static version. Preserves any querystring (e.g. `?size=128`).
  return url.replace(/\.gif(\?|$)/, '.webp$1');
}
