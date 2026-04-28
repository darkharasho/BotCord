import { describe, it, expect } from 'vitest';
import { openDatabase } from '../../database';
import { createPrefsRepo } from '../prefs';

describe('prefs repo', () => {
  it('returns null for unset keys', () => {
    const db = openDatabase(':memory:');
    const repo = createPrefsRepo(db);
    expect(repo.get('lastSelectedGuildId')).toBe(null);
  });

  it('round-trips a string value', () => {
    const db = openDatabase(':memory:');
    const repo = createPrefsRepo(db);
    repo.set('lastSelectedGuildId', '12345');
    expect(repo.get('lastSelectedGuildId')).toBe('12345');
  });

  it('overwrites existing values', () => {
    const db = openDatabase(':memory:');
    const repo = createPrefsRepo(db);
    repo.set('lastSelectedGuildId', 'a');
    repo.set('lastSelectedGuildId', 'b');
    expect(repo.get('lastSelectedGuildId')).toBe('b');
  });
});
