import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { ChannelSummary } from '../../shared/domain';
import { CategoryGroup } from './CategoryGroup';
import {
  IconHash,
  IconVolume,
  IconSpeakerphone,
  IconMessages,
  IconCornerDownRight,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';

export function ChannelList({
  guildId, selected, onSelect, unreadIds,
}: { guildId: string | null; selected: string | null; onSelect: (id: string) => void; unreadIds?: Set<string> }) {
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.prefs.get('collapsedCategoryIds').then(res => {
      if (res.ok && Array.isArray(res.data)) setCollapsed(new Set(res.data));
    });
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      api.prefs.set('collapsedCategoryIds', Array.from(collapsed));
    }, 300);
    return () => clearTimeout(handle);
  }, [collapsed]);

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
      list.sort((a, b) => a.position - b.position);
      byParent.set(k, list);
    }
    return { categories, byParent };
  }, [channels]);

  if (!guildId) return <div className="p-3 text-fg-muted text-sm">Select a server.</div>;

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
    return (
      <div key={c.id} className="relative">
        {isUnread && (
          <span className="absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-2 bg-fg rounded-r-full" />
        )}
        <button
          onClick={() => onSelect(c.id)}
          className={`w-full flex items-center gap-1.5 px-2 py-[5px] rounded text-left text-[15px] leading-5
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
      </div>
    );
  };

  const uncategorized = grouped.byParent.get(null) ?? [];
  const childrenOfTextChannel = (parentTextChannelId: string) => grouped.byParent.get(parentTextChannelId) ?? [];

  const renderChannelWithThreads = (c: ChannelSummary) => (
    <div key={c.id}>
      {renderChannel(c)}
      {childrenOfTextChannel(c.id)
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
