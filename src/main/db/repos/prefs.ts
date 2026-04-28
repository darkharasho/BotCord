import type { Database as DB } from 'better-sqlite3';
import type { Prefs } from '../../../shared/domain';

export interface PrefsRepo {
  get<K extends keyof Prefs>(key: K): Prefs[K] | null;
  set<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
}

export function createPrefsRepo(db: DB): PrefsRepo {
  const getStmt = db.prepare('SELECT value_json FROM prefs WHERE key=?');
  const upsertStmt = db.prepare(`
    INSERT INTO prefs (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
  `);
  return {
    get<K extends keyof Prefs>(key: K) {
      const row = getStmt.get(key) as { value_json: string } | undefined;
      return row ? (JSON.parse(row.value_json) as Prefs[K]) : null;
    },
    set<K extends keyof Prefs>(key: K, value: Prefs[K]) {
      upsertStmt.run(key, JSON.stringify(value), Date.now());
    },
  };
}
