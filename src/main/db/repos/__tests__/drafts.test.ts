import { describe, it, expect } from 'vitest';
import { openDatabase } from '../../database';
import { createDraftsRepo } from '../drafts';

describe('drafts repo', () => {
  it('upserts and lists drafts', () => {
    const db = openDatabase(':memory:');
    const repo = createDraftsRepo(db);
    const a = repo.upsert({ name: 'A', guildId: null, channelId: null, content: 'hi', embed: null });
    expect(a.id).toBeTruthy();
    expect(a.createdAt).toBe(a.updatedAt);
    const list = repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('A');
  });

  it('updates an existing draft preserving createdAt', async () => {
    const db = openDatabase(':memory:');
    const repo = createDraftsRepo(db);
    const a = repo.upsert({ name: 'A', guildId: null, channelId: null, content: 'hi', embed: null });
    await new Promise(r => setTimeout(r, 5));
    const b = repo.upsert({ id: a.id, name: 'A2', guildId: null, channelId: null, content: 'bye', embed: null });
    expect(b.id).toBe(a.id);
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.updatedAt).toBeGreaterThan(a.updatedAt);
    expect(b.name).toBe('A2');
  });

  it('deletes by id', () => {
    const db = openDatabase(':memory:');
    const repo = createDraftsRepo(db);
    const a = repo.upsert({ name: 'A', guildId: null, channelId: null, content: null, embed: null });
    repo.delete(a.id);
    expect(repo.list()).toHaveLength(0);
  });
});
