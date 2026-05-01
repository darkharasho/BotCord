import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { MIGRATIONS } from '../../migrations';
import { createDMChannelsRepo } from '../dm-channels';

function makeDb(): DB {
  const db = new Database(':memory:');
  for (const m of MIGRATIONS) db.exec(m.sql);
  return db;
}

describe('dm-channels repo', () => {
  let db: DB;
  beforeEach(() => { db = makeDb(); });

  it('upserts a new row and returns it', () => {
    const repo = createDMChannelsRepo(db);
    const row = repo.upsert({
      channelId: 'c1',
      userId: 'u1',
      userUsername: 'alice',
      userGlobalName: 'Alice',
      userAvatar: 'https://cdn/x.png',
      lastMessageId: 'm1',
      lastMessagePreview: 'hi',
    });
    expect(row.channelId).toBe('c1');
    expect(row.userUsername).toBe('alice');
    expect(row.inert).toBe(false);
    expect(row.createdAt).toBeGreaterThan(0);
    expect(row.updatedAt).toBe(row.createdAt);
  });

  it('upsert updates existing row, preserves createdAt, bumps updatedAt', async () => {
    const repo = createDMChannelsRepo(db);
    const first = repo.upsert({
      channelId: 'c1', userId: 'u1', userUsername: 'alice',
      userGlobalName: null, userAvatar: null,
      lastMessageId: 'm1', lastMessagePreview: 'hi',
    });
    await new Promise(r => setTimeout(r, 5));
    const second = repo.upsert({
      channelId: 'c1', userId: 'u1', userUsername: 'alice',
      userGlobalName: null, userAvatar: null,
      lastMessageId: 'm2', lastMessagePreview: 'hello again',
    });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(second.lastMessageId).toBe('m2');
    expect(second.lastMessagePreview).toBe('hello again');
  });

  it('list orders by updatedAt DESC and excludes inert by default', async () => {
    const repo = createDMChannelsRepo(db);
    repo.upsert({ channelId: 'a', userId: 'ua', userUsername: 'a', userGlobalName: null, userAvatar: null, lastMessageId: null, lastMessagePreview: null });
    await new Promise(r => setTimeout(r, 5));
    repo.upsert({ channelId: 'b', userId: 'ub', userUsername: 'b', userGlobalName: null, userAvatar: null, lastMessageId: null, lastMessagePreview: null });
    await new Promise(r => setTimeout(r, 5));
    repo.upsert({ channelId: 'c', userId: 'uc', userUsername: 'c', userGlobalName: null, userAvatar: null, lastMessageId: null, lastMessagePreview: null });
    repo.markInert('b');

    const list = repo.list();
    expect(list.map(r => r.channelId)).toEqual(['c', 'a']);

    const all = repo.list({ includeInert: true });
    expect(all.map(r => r.channelId)).toEqual(['c', 'a', 'b']);
  });

  it('get returns null when missing', () => {
    const repo = createDMChannelsRepo(db);
    expect(repo.get('nope')).toBeNull();
  });

  it('markInert flips the inert flag', () => {
    const repo = createDMChannelsRepo(db);
    repo.upsert({ channelId: 'x', userId: 'u', userUsername: 'x', userGlobalName: null, userAvatar: null, lastMessageId: null, lastMessagePreview: null });
    repo.markInert('x');
    const row = repo.get('x');
    expect(row?.inert).toBe(true);
  });
});
