import { useEffect, useRef, useState } from 'react';
import { IconRobot, IconCheck } from '@tabler/icons-react';
import { api } from '../lib/api';
import type { GuildSummary } from '../../shared/domain';
import { Tooltip } from './Tooltip';
import { openContextMenu } from './ContextMenu';
import { AutonomySettingsTab } from './AutonomySettingsTab';

const ANIMATED_PLAY_MS = 3000; // play once on mount for ~3s, then freeze on first frame

export function ServerRail({
  selected, onSelect, unreadGuildIds, mentionGuildIds, onMarkRead,
}: {
  selected: string | null;
  onSelect: (g: GuildSummary) => void;
  unreadGuildIds?: Set<string>;
  mentionGuildIds?: Set<string>;
  onMarkRead?: (guildId: string) => void;
}) {
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autonomyModalForGuild, setAutonomyModalForGuild] = useState<{ id: string; name: string } | null>(null);

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
    <>
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
            mention={!!mentionGuildIds?.has(g.id)}
            onSelect={onSelect}
            onOpenAutonomy={() => setAutonomyModalForGuild({ id: g.id, name: g.name })}
            {...(onMarkRead ? { onMarkRead: () => onMarkRead(g.id) } : {})}
            hasUnread={!!unreadGuildIds?.has(g.id) || !!mentionGuildIds?.has(g.id)}
          />
        ))}
        {guilds.length === 0 && !error && (
          <div className="text-fg-dim text-[10px] px-1 text-center">No guilds</div>
        )}
      </div>
      {autonomyModalForGuild && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setAutonomyModalForGuild(null)}>
          <div className="bg-bg-subtle border border-border rounded-lg p-6 w-[32rem] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-fg mb-4">Autonomy — {autonomyModalForGuild.name}</h2>
            <AutonomySettingsTab guildId={autonomyModalForGuild.id} />
            <button className="mt-4 w-full px-3 py-2 rounded border border-border text-fg hover:bg-bg-sunken" onClick={() => setAutonomyModalForGuild(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}

function GuildRailItem({
  guild, selected, unread, mention, onSelect, onOpenAutonomy, onMarkRead, hasUnread,
}: { guild: GuildSummary; selected: boolean; unread: boolean; mention: boolean; onSelect: (g: GuildSummary) => void; onOpenAutonomy: () => void; onMarkRead?: () => void; hasUnread: boolean }) {
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
        onContextMenu={(e) => {
          const items: Parameters<typeof openContextMenu>[1] = [];
          if (onMarkRead && hasUnread) {
            items.push({
              type: 'item',
              label: 'Mark as read',
              icon: <IconCheck size={14} />,
              onClick: onMarkRead,
            });
          }
          items.push({
            type: 'item',
            label: 'Autonomy settings',
            icon: <IconRobot size={14} />,
            onClick: onOpenAutonomy,
          });
          openContextMenu(e, items);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative"
      >
        <span
          className={`absolute -left-3 top-1/2 -translate-y-1/2 w-1 bg-fg rounded-r transition-all duration-200 ease-out ${sideIndicator}`}
        />
        <div
          className={`w-10 h-10 rounded-2xl overflow-hidden bg-bg-subtle flex items-center justify-center text-sm font-semibold text-fg transition-colors duration-150
            ${selected ? 'bg-accent text-white' : 'hover:bg-accent hover:text-white'}`}
        >
          {iconSrc
            ? <img src={iconSrc} alt="" className="w-full h-full object-cover" />
            : guild.name.slice(0, 2).toUpperCase()}
        </div>
        {mention && (
          <span className="absolute -right-0.5 -bottom-0.5 w-3.5 h-3.5 rounded-full bg-danger ring-[3px] ring-bg-sunken animate-fade-in" aria-label="mention" />
        )}
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
