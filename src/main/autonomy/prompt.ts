import type { PromptInputs, ChannelHistoryEntry } from './types';

const HARD_RULES = [
  'You are participating in a Discord text channel.',
  'Stay in character.',
  'Reply with exactly one Discord message.',
  'Never use @everyone or @here.',
  'Keep replies under 2000 characters.',
  'Use plain text. No markdown headings or code fences unless asked.',
  'Mentions in messages are tagged: `@Name [ping <@ID>]` means the user was actually pinged. A bare name with no `[ping …]` marker is just plain text — treat it as casual reference, not as someone being summoned.',
  'To ping a user back, write the literal `<@USER_ID>` token using the ID shown in their handle. Do not invent IDs. If you do not need to ping, just use their name as plain text.',
].join('\n');

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

const renderEntry = (e: ChannelHistoryEntry): string => {
  const showUsername = e.authorUsername && e.authorUsername !== e.authorDisplayName;
  const nameAndUser = showUsername ? `${e.authorDisplayName} (${e.authorUsername})` : e.authorDisplayName;
  const handle = `${nameAndUser} <@${e.authorId}>`;
  return `[${formatTime(e.createdAt)}] ${handle}${e.isBot ? ' (bot)' : ''}: ${e.content}`;
};

export function buildPrompt(inputs: PromptInputs): string {
  const { systemPrompt, channelMeta, history, target } = inputs;
  const topicLine = channelMeta.channelTopic ? `Topic: ${channelMeta.channelTopic}` : '';
  const meta = [
    `Server: ${channelMeta.guildName}`,
    `Channel: #${channelMeta.channelName}`,
    topicLine,
  ].filter(Boolean).join('\n');

  const historyBlock = history.length === 0
    ? '(no recent messages)'
    : history.map(renderEntry).join('\n');

  return [
    'SYSTEM RULES (must obey):',
    HARD_RULES,
    '',
    'PERSONA:',
    systemPrompt,
    '',
    'CHANNEL:',
    meta,
    '',
    'Recent channel context — for situational awareness only. Do NOT respond to these messages:',
    historyBlock,
    '',
    'Respond to this single message:',
    renderEntry(target),
  ].join('\n');
}
