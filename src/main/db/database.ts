import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { MIGRATIONS } from './migrations';

export function openDatabase(path: string): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

export function applyMigrations(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>)
      .map(r => r.version)
  );

  for (const { version, sql } of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (applied.has(version)) continue;
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)')
        .run(version, Date.now());
    });
    tx();
  }
}
