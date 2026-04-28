import { useEffect, useState } from 'react';
import type { GuildEmoji } from '../../shared/domain';
import { api } from './api';

export function useGuildEmojis(guildId: string | null): GuildEmoji[] {
  const [emojis, setEmojis] = useState<GuildEmoji[]>([]);

  useEffect(() => {
    if (!guildId) { setEmojis([]); return; }
    let active = true;
    api.guilds.listEmojis(guildId).then(res => {
      if (!active) return;
      if (res.ok) setEmojis(res.data);
    });
    const unsub = api.events.onGuildEmojisUpdate(({ guildId: gid, emojis: list }) => {
      if (gid === guildId) setEmojis(list);
    });
    return () => { active = false; unsub(); };
  }, [guildId]);

  return emojis;
}
