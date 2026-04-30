import type { Database as DB } from 'better-sqlite3';
import type { GuildAutonomyConfig } from '../../../shared/domain';

type Row = {
  guild_id: string;
  enabled: number;
  channel_ids: string;
  context_size: number;
  system_prompt: string | null;
  cooldown_ms: number;
  updated_at: number;
};

const toDomain = (r: Row): GuildAutonomyConfig => ({
  guildId: r.guild_id,
  enabled: r.enabled === 1,
  channelIds: JSON.parse(r.channel_ids) as string[],
  contextSize: r.context_size,
  systemPrompt: r.system_prompt,
  cooldownMs: r.cooldown_ms,
  updatedAt: r.updated_at,
});

const defaultsFor = (guildId: string): GuildAutonomyConfig => ({
  guildId, enabled: false, channelIds: [], contextSize: 20,
  systemPrompt: null, cooldownMs: 5000, updatedAt: 0,
});

export interface AutonomyRepo {
  getGuildConfig(guildId: string): GuildAutonomyConfig;
  upsertGuildConfig(guildId: string, partial: Partial<Omit<GuildAutonomyConfig, 'guildId' | 'updatedAt'>>): GuildAutonomyConfig;
  setChannelEnabled(guildId: string, channelId: string, enabled: boolean): GuildAutonomyConfig;
}

export function createAutonomyRepo(db: DB): AutonomyRepo {
  const getStmt = db.prepare('SELECT * FROM autonomy_guild_config WHERE guild_id=?');
  const upsertStmt = db.prepare(`
    INSERT INTO autonomy_guild_config (guild_id, enabled, channel_ids, context_size, system_prompt, cooldown_ms, updated_at)
    VALUES (@guild_id, @enabled, @channel_ids, @context_size, @system_prompt, @cooldown_ms, @updated_at)
    ON CONFLICT(guild_id) DO UPDATE SET
      enabled=excluded.enabled,
      channel_ids=excluded.channel_ids,
      context_size=excluded.context_size,
      system_prompt=excluded.system_prompt,
      cooldown_ms=excluded.cooldown_ms,
      updated_at=excluded.updated_at
  `);

  const read = (guildId: string): GuildAutonomyConfig => {
    const row = getStmt.get(guildId) as Row | undefined;
    return row ? toDomain(row) : defaultsFor(guildId);
  };

  return {
    getGuildConfig: read,

    upsertGuildConfig(guildId, partial) {
      const current = read(guildId);
      const merged: GuildAutonomyConfig = {
        ...current,
        ...partial,
        guildId,
        updatedAt: Date.now(),
      };
      upsertStmt.run({
        guild_id: merged.guildId,
        enabled: merged.enabled ? 1 : 0,
        channel_ids: JSON.stringify(merged.channelIds),
        context_size: merged.contextSize,
        system_prompt: merged.systemPrompt,
        cooldown_ms: merged.cooldownMs,
        updated_at: merged.updatedAt,
      });
      return merged;
    },

    setChannelEnabled(guildId, channelId, enabled) {
      const current = read(guildId);
      const set = new Set(current.channelIds);
      if (enabled) set.add(channelId); else set.delete(channelId);
      return this.upsertGuildConfig(guildId, { channelIds: Array.from(set) });
    },
  };
}
