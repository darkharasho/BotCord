import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { ChannelSummary, VoiceMemberSummary } from '../../shared/domain';
import { CategoryGroup } from './CategoryGroup';
import {
  IconHash,
  IconVolume,
  IconSpeakerphone,
  IconMessages,
  IconCornerDownRight,
  IconMicrophoneOff,
  IconHeadphonesOff,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';

export function ChannelList({
  guildId, selected, onSelect, unreadIds,
}: { guildId: string | null; selected: string | null; onSelect: (id: string) => void; unreadIds?: Set<string> }) {
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const loaded = useRef(false);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  // Hydrate from prefs once, then mark loaded so the persistence effect can
  // start saving without overwriting the just-loaded value.
  useEffect(() => {
    api.prefs.get('collapsedCategoryIds').then(res => {
      if (res.ok && Array.isArray(res.data)) setCollapsed(new Set(res.data));
      loaded.current = true;
    });
  }, []);

  // Persist immediately on toggle once we've hydrated. No debounce so a fast
  // app close still captures the latest state.
  useEffect(() => {
    if (!loaded.current) return;
    api.prefs.set('collapsedCategoryIds', Array.from(collapsed));
  }, [collapsed]);

  // Belt-and-braces: also flush on unmount in case the renderer unmounts
  // before the IPC ack returns from the previous effect.
  useEffect(() => () => {
    api.prefs.set('collapsedCategoryIds', Array.from(collapsedRef.current));
  }, []);

  useEffect(() => {
    if (!guildId) { setChannels([]); return; }
    let active = true;
    const load = async () => {
      const res = await api.guilds.listChannels(guildId);
      if (!active) return;
      if (res.ok) setChannels(res.data);
    };
    load();
    const unsub = api.events.onChannelUpdate((c) => { if (c.guildId === guildId) load(); });
    return () => { active = false; unsub(); };
  }, [guildId]);

  const grouped = useMemo(() => {
    const categories = channels.filter(c => c.type === 'category').sort((a, b) => a.position - b.position);
    const byParent = new Map<string | null, ChannelSummary[]>();
    for (const c of channels) {
      if (c.type === 'category') continue;
      const key = c.parentId;
      const list = byParent.get(key) ?? [];
      list.push(c);
      byParent.set(key, list);
    }
    for (const [k, list] of byParent) {
      // Match Discord's ordering: text-like channels first (text,
      // announcement, forum), then voice/stage at the bottom. Within each
      // kind the API's `position` decides the order.
      list.sort((a, b) => kindWeight(a.type) - kindWeight(b.type) || a.position - b.position);
      byParent.set(k, list);
    }
    return { categories, byParent };
  }, [channels]);

  if (!guildId) return (
    <div className="h-full flex flex-col items-center justify-center px-4 text-center">
      <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center mb-3">
        <IconHash size={20} stroke={1.5} className="text-fg-dim" />
      </div>
      <p className="text-fg-dim text-[13px] leading-relaxed">Select a server<br />to browse channels</p>
    </div>
  );

  const toggle = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const renderChannel = (c: ChannelSummary, indent = false) => {
    const Glyph = kindGlyph(c.type);
    const isSelected = selected === c.id;
    const isUnread = !isSelected && unreadIds?.has(c.id);
    const voiceMembers = c.type === 'voice' ? (c.voiceMembers ?? []) : [];
    return (
      <div key={c.id} className="relative">
        {isUnread && (
          <span className="absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-2 bg-fg rounded-r-full animate-fade-in" />
        )}
        <button
          onClick={() => onSelect(c.id)}
          className={`w-full flex items-center gap-1.5 px-2 py-[5px] rounded text-left text-[15px] leading-5 transition-colors duration-150
            ${indent ? 'pl-7' : ''}
            ${isSelected
              ? 'bg-selected text-fg'
              : isUnread
                ? 'text-fg font-medium hover:bg-hover'
                : 'text-fg-dim hover:bg-hover hover:text-fg-muted'}`}
        >
          <Glyph size={20} stroke={1.75} className={isUnread ? 'text-fg shrink-0' : 'text-fg-dim shrink-0'} />
          <span className="truncate">{c.name}</span>
        </button>
        {voiceMembers.length > 0 && (
          <ul className="mt-0.5 space-y-px">
            {voiceMembers.map(m => (
              <VoiceMemberRow key={m.id} member={m} indent={indent} />
            ))}
          </ul>
        )}
      </div>
    );
  };

  const uncategorized = grouped.byParent.get(null) ?? [];
  const childrenOfTextChannel = (parentTextChannelId: string) => grouped.byParent.get(parentTextChannelId) ?? [];

  const renderChannelWithThreads = (c: ChannelSummary) => (
    <div key={c.id}>
      {renderChannel(c)}
      {/* Forum threads are posts and live in the forum view, not the sidebar. */}
      {c.type !== 'forum' && childrenOfTextChannel(c.id)
        .filter(t => t.type === 'thread')
        .map(t => renderChannel(t, true))}
    </div>
  );

  return (
    <div className="h-full overflow-y-auto px-2 pt-2 pb-4">
      {uncategorized
        .filter(c => c.type !== 'thread')
        .map(renderChannelWithThreads)}
      {grouped.categories.map(cat => {
        const items = (grouped.byParent.get(cat.id) ?? []).filter(c => c.type !== 'thread');
        return (
          <CategoryGroup
            key={cat.id}
            name={cat.name}
            collapsed={collapsed.has(cat.id)}
            onToggle={() => toggle(cat.id)}
          >
            {items.map(renderChannelWithThreads)}
          </CategoryGroup>
        );
      })}
    </div>
  );
}

// One row under a voice channel listing a connected member. Mirrors Discord:
// small avatar, display name, mute/deaf icons on the right when applicable.
// `indent` matches the parent channel button's left padding so members align
// just past the channel's icon column.
function VoiceMemberRow({ member, indent }: { member: VoiceMemberSummary; indent: boolean }) {
  const muted = member.selfMute || member.serverMute;
  const deafened = member.selfDeaf || member.serverDeaf;
  // Server-enforced mute/deaf renders in danger red; self-muted is muted-fg.
  const muteColor = member.serverMute ? 'text-danger' : 'text-fg-dim';
  const deafColor = member.serverDeaf ? 'text-danger' : 'text-fg-dim';
  return (
    <li
      className={`flex items-center gap-2 px-2 py-1 rounded text-fg-muted hover:bg-hover hover:text-fg transition-colors duration-150 animate-fade-in
        ${indent ? 'pl-12' : 'pl-7'}`}
    >
      {member.avatarUrl
        ? <img src={member.avatarUrl} alt="" className="w-[18px] h-[18px] rounded-full shrink-0" />
        : <div className="w-[18px] h-[18px] rounded-full bg-bg-input shrink-0" />}
      <span
        className="flex-1 truncate text-[14px] leading-4"
        style={member.roleColor ? { color: member.roleColor } : undefined}
      >
        {member.displayName}
      </span>
      {muted && <IconMicrophoneOff size={14} stroke={2} className={`${muteColor} shrink-0`} />}
      {deafened && <IconHeadphonesOff size={14} stroke={2} className={`${deafColor} shrink-0`} />}
    </li>
  );
}

// Discord groups channels by "kind" before sorting by position — text-like
// channels render above voice/stage within the same category.
function kindWeight(t: ChannelSummary['type']): number {
  switch (t) {
    case 'text':
    case 'announcement':
    case 'forum':
    case 'thread':
      return 0;
    case 'voice':
      return 1;
    default:
      return 2;
  }
}

function kindGlyph(t: ChannelSummary['type']): Icon {
  switch (t) {
    case 'text': return IconHash;
    case 'announcement': return IconSpeakerphone;
    case 'voice': return IconVolume;
    case 'thread': return IconCornerDownRight;
    case 'forum': return IconMessages;
    case 'category': return IconHash;
    default: return IconHash;
  }
}
