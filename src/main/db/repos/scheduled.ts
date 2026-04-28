import type { Database as DB } from 'better-sqlite3';

export type ScheduledPostStatus = 'pending' | 'sent' | 'failed' | 'canceled';

export interface ScheduledRepo {
  countByStatus(status: ScheduledPostStatus): number;
}

export function createScheduledRepo(db: DB): ScheduledRepo {
  const stmt = db.prepare('SELECT COUNT(*) as c FROM scheduled_posts WHERE status = ?');
  return {
    countByStatus: (status) => (stmt.get(status) as { c: number }).c,
  };
}
