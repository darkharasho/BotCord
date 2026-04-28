import type { Database as DB } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { DraftInput, DraftRow, EmbedPayload } from '../../../shared/domain';

type Row = {
  id: string;
  name: string;
  guild_id: string | null;
  channel_id: string | null;
  content: string | null;
  embed_json: string | null;
  created_at: number;
  updated_at: number;
};

const toDomain = (r: Row): DraftRow => ({
  id: r.id,
  name: r.name,
  guildId: r.guild_id,
  channelId: r.channel_id,
  content: r.content,
  embed: r.embed_json ? (JSON.parse(r.embed_json) as EmbedPayload) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface DraftsRepo {
  list(): DraftRow[];
  upsert(input: DraftInput): DraftRow;
  delete(id: string): void;
}

export function createDraftsRepo(db: DB): DraftsRepo {
  const insertStmt = db.prepare(`
    INSERT INTO drafts (id, name, guild_id, channel_id, content, embed_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE drafts SET name=?, guild_id=?, channel_id=?, content=?, embed_json=?, updated_at=?
    WHERE id=?
  `);
  const getStmt = db.prepare('SELECT * FROM drafts WHERE id=?');
  const listStmt = db.prepare('SELECT * FROM drafts ORDER BY updated_at DESC');
  const deleteStmt = db.prepare('DELETE FROM drafts WHERE id=?');

  return {
    list: () => (listStmt.all() as Row[]).map(toDomain),

    upsert(input) {
      const now = Date.now();
      const embedJson = input.embed ? JSON.stringify(input.embed) : null;
      if (input.id) {
        const existing = getStmt.get(input.id) as Row | undefined;
        if (existing) {
          updateStmt.run(input.name, input.guildId, input.channelId, input.content, embedJson, now, input.id);
          return toDomain({ ...existing, name: input.name, guild_id: input.guildId, channel_id: input.channelId, content: input.content, embed_json: embedJson, updated_at: now });
        }
      }
      const id = input.id ?? randomUUID();
      insertStmt.run(id, input.name, input.guildId, input.channelId, input.content, embedJson, now, now);
      return toDomain(getStmt.get(id) as Row);
    },

    delete: (id) => { deleteStmt.run(id); },
  };
}
