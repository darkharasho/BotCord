import type { Database as DB } from 'better-sqlite3';
import type { DMChannelRow, DMChannelUpsert } from '../../../shared/domain';

type Row = {
  channel_id: string;
  user_id: string;
  user_username: string;
  user_global_name: string | null;
  user_avatar: string | null;
  last_message_id: string | null;
  last_message_preview: string | null;
  inert: number;
  created_at: number;
  updated_at: number;
};

const toDomain = (r: Row): DMChannelRow => ({
  channelId: r.channel_id,
  userId: r.user_id,
  userUsername: r.user_username,
  userGlobalName: r.user_global_name,
  userAvatar: r.user_avatar,
  lastMessageId: r.last_message_id,
  lastMessagePreview: r.last_message_preview,
  inert: r.inert === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface DMChannelsRepo {
  list(opts?: { includeInert?: boolean }): DMChannelRow[];
  get(channelId: string): DMChannelRow | null;
  upsert(input: DMChannelUpsert): DMChannelRow;
  markInert(channelId: string): void;
  markRead(channelId: string): void;
}

export function createDMChannelsRepo(db: DB): DMChannelsRepo {
  const getStmt = db.prepare('SELECT * FROM dm_channels WHERE channel_id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO dm_channels (
      channel_id, user_id, user_username, user_global_name, user_avatar,
      last_message_id, last_message_preview, inert, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE dm_channels
       SET user_id = ?, user_username = ?, user_global_name = ?, user_avatar = ?,
           last_message_id = ?, last_message_preview = ?, updated_at = ?
     WHERE channel_id = ?
  `);
  const listAllStmt = db.prepare('SELECT * FROM dm_channels ORDER BY inert ASC, updated_at DESC');
  const listActiveStmt = db.prepare('SELECT * FROM dm_channels WHERE inert = 0 ORDER BY updated_at DESC');
  const markInertStmt = db.prepare('UPDATE dm_channels SET inert = 1 WHERE channel_id = ?');

  return {
    list(opts) {
      const rows = (opts?.includeInert ? listAllStmt.all() : listActiveStmt.all()) as Row[];
      return rows.map(toDomain);
    },

    get(channelId) {
      const row = getStmt.get(channelId) as Row | undefined;
      return row ? toDomain(row) : null;
    },

    upsert(input) {
      const now = Date.now();
      const existing = getStmt.get(input.channelId) as Row | undefined;
      if (existing) {
        updateStmt.run(
          input.userId, input.userUsername, input.userGlobalName, input.userAvatar,
          input.lastMessageId, input.lastMessagePreview, now, input.channelId,
        );
      } else {
        insertStmt.run(
          input.channelId, input.userId, input.userUsername, input.userGlobalName, input.userAvatar,
          input.lastMessageId, input.lastMessagePreview, now, now,
        );
      }
      return toDomain(getStmt.get(input.channelId) as Row);
    },

    markInert(channelId) {
      markInertStmt.run(channelId);
    },

    markRead(_channelId) {
      // Unread state lives client-side via prefs (channelLastSeen).
    },
  };
}
