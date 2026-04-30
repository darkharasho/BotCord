import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../prompt';
import type { PromptInputs } from '../types';

const baseInputs = (): PromptInputs => ({
  systemPrompt: 'be helpful',
  channelMeta: { guildName: 'My Server', channelName: 'general', channelTopic: 'casual chat' },
  history: [
    { authorId: 'u1', authorDisplayName: 'Alice', isBot: false, createdAt: Date.UTC(2026, 3, 29, 12, 0, 0), content: 'hi all' },
    { authorId: 'u2', authorDisplayName: 'Bob', isBot: false, createdAt: Date.UTC(2026, 3, 29, 12, 1, 0), content: 'hey' },
  ],
  target: { id: 'm1', authorId: 'u1', authorDisplayName: 'Alice', isBot: false, createdAt: Date.UTC(2026, 3, 29, 12, 2, 0), content: '@bot what time is it?' },
});

describe('buildPrompt', () => {
  it('puts system rules + persona at the top', () => {
    const out = buildPrompt(baseInputs());
    expect(out).toMatch(/Stay in character/);
    expect(out).toMatch(/exactly one Discord message/);
    expect(out).toMatch(/Never use @everyone or @here/);
    expect(out).toMatch(/under 2000 characters/);
    expect(out).toMatch(/be helpful/);
  });

  it('includes channel metadata', () => {
    const out = buildPrompt(baseInputs());
    expect(out).toMatch(/My Server/);
    expect(out).toMatch(/#general/);
    expect(out).toMatch(/casual chat/);
  });

  it('separates background context from the target message', () => {
    const out = buildPrompt(baseInputs());
    const ctxIdx = out.indexOf('Recent channel context');
    const tgtIdx = out.indexOf('Respond to this single message');
    expect(ctxIdx).toBeGreaterThan(0);
    expect(tgtIdx).toBeGreaterThan(ctxIdx);
    expect(out).toMatch(/do NOT respond to these/i);
  });

  it('renders history entries with display name and time', () => {
    const out = buildPrompt(baseInputs());
    expect(out).toMatch(/Alice.*hi all/s);
    expect(out).toMatch(/Bob.*hey/s);
  });

  it('omits topic line when topic is null', () => {
    const inputs = baseInputs();
    inputs.channelMeta.channelTopic = null;
    const out = buildPrompt(inputs);
    expect(out).not.toMatch(/Topic:/);
  });

  it('handles empty history with a placeholder', () => {
    const inputs = baseInputs();
    inputs.history = [];
    const out = buildPrompt(inputs);
    expect(out).toMatch(/no recent messages/i);
  });
});
