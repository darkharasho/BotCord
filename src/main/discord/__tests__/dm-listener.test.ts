import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { MIGRATIONS } from '../../db/migrations';
import { createDMChannelsRepo } from '../../db/repos/dm-channels';
import { attachDMListener } from '../dm-listener';
import { Events, ChannelType } from 'discord.js';

function makeDb(): DB {
  const db = new Database(':memory:');
  for (const m of MIGRATIONS) db.exec(m.sql);
  return db;
}

function dmMessage(overrides: Partial<{ id: string; content: string; userId: string; username: string; channelId: string; isBot: boolean }> = {}) {
  return {
    id: overrides.id ?? 'm1',
    content: overrides.content ?? 'hello',
    channelId: overrides.channelId ?? 'c1',
    attachments: { size: 0 },
    embeds: [],
    author: {
      id: overrides.userId ?? 'u1',
      bot: overrides.isBot ?? false,
      username: overrides.username ?? 'alice',
      globalName: 'Alice',
      displayAvatarURL: () => 'https://cdn/avatar.png',
    },
    channel: { type: ChannelType.DM, id: overrides.channelId ?? 'c1', recipient: { id: overrides.userId ?? 'u1', username: overrides.username ?? 'alice', globalName: 'Alice', displayAvatarURL: () => 'https://cdn/avatar.png' } },
  };
}

describe('attachDMListener', () => {
  let db: DB;
  let client: EventEmitter & { user: { id: string }; on: typeof EventEmitter.prototype.on };

  beforeEach(() => {
    db = makeDb();
    client = Object.assign(new EventEmitter(), { user: { id: 'bot1' } });
  });

  it('upserts a row when a DM messageCreate fires', () => {
    const repo = createDMChannelsRepo(db);
    attachDMListener(client as never, repo);
    client.emit(Events.MessageCreate, dmMessage({ content: 'hello world' }));
    const row = repo.get('c1');
    expect(row).not.toBeNull();
    expect(row!.userId).toBe('u1');
    expect(row!.userUsername).toBe('alice');
    expect(row!.lastMessageId).toBe('m1');
    expect(row!.lastMessagePreview).toBe('hello world');
  });

  it('ignores non-DM messages', () => {
    const repo = createDMChannelsRepo(db);
    attachDMListener(client as never, repo);
    const guildMsg = dmMessage();
    guildMsg.channel = { type: ChannelType.GuildText, id: 'g1' } as never;
    client.emit(Events.MessageCreate, guildMsg);
    expect(repo.list()).toHaveLength(0);
  });

  it('truncates preview to 200 chars', () => {
    const repo = createDMChannelsRepo(db);
    attachDMListener(client as never, repo);
    client.emit(Events.MessageCreate, dmMessage({ content: 'x'.repeat(500) }));
    const row = repo.get('c1');
    expect(row!.lastMessagePreview!.length).toBeLessThanOrEqual(200);
  });

  it('marks channel inert when fetch returns Unknown Channel during backfill', async () => {
    const repo = createDMChannelsRepo(db);
    repo.upsert({
      channelId: 'c1', userId: 'u1', userUsername: 'alice',
      userGlobalName: null, userAvatar: null,
      lastMessageId: 'm0', lastMessagePreview: 'old',
    });
    const c = Object.assign(new EventEmitter(), {
      user: { id: 'bot1' },
      channels: { fetch: vi.fn(async () => { const e: { code?: number } & Error = Object.assign(new Error('Unknown Channel'), { code: 10003 }); throw e; }) },
    });
    const { runBackfill } = attachDMListener(c as never, repo);
    await runBackfill();
    expect(repo.get('c1')!.inert).toBe(true);
  });
});
