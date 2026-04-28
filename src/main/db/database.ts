import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

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

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const m = /^(\d+)_/.exec(file);
    if (!m) continue;
    const version = Number(m[1]);
    if (applied.has(version)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)')
        .run(version, Date.now());
    });
    tx();
  }
}
