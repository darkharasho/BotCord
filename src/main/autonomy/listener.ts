import { Events, type Client, type Message, type MessageCreateOptions } from 'discord.js';
import type { ClientManager } from '../discord/client-manager';
import type { AutonomyModule } from './index';
import { broadcast } from '../events/gateway-events';
import { MESSAGE_CREATE_CHANNEL } from '../events/gateway-events';
import type { AutonomyRepo } from '../db/repos/autonomy';
import { summarizeMessage } from '../discord/client-manager';

type SendableChannel = { send: (opts: MessageCreateOptions) => Promise<Message> };
type TypingChannel = { sendTyping: () => Promise<void> };

type Deps = {
  manager: ClientManager;
  autonomy: AutonomyModule;
  repo: AutonomyRepo;
};

export function attachAutonomousListener({ manager, autonomy, repo }: Deps): () => void {
  let attached = false;
  let bound: ((m: Message) => void) | null = null;

  const tryAttach = () => {
    const client: Client | null = manager.getClient();
    if (!client || attached) return;
    attached = true;
    bound = (m: Message) => { void handle(m, client); };
    client.on(Events.MessageCreate, bound);
  };

  const handle = async (m: Message, client: Client) => {
    if (m.author.bot) return;
    if (!m.guildId) return;
    if (m.system) return;

    const botId = client.user?.id;
    if (!botId) return;

    const isMention = m.mentions.has(botId);
    const isReplyToBot = !!m.reference?.messageId && (await isReplyTargetingBot(m, botId));
    if (!isMention && !isReplyToBot) return;

    const cfg = repo.getGuildConfig(m.guildId);
    if (!cfg.enabled || !cfg.channelIds.includes(m.channelId)) return;

    const ch = m.channel;
    const histLimit = Math.min(cfg.contextSize, 100);
    const fetched = await ch.messages.fetch({ limit: histLimit + 1, before: m.id }).catch(() => null);
    const history = fetched
      ? Array.from(fetched.values())
          .filter(x => x.id !== m.id)
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .map(x => ({
            authorId: x.author.id,
            authorDisplayName: x.member?.displayName ?? x.author.globalName ?? x.author.username,
            isBot: x.author.bot ?? false,
            createdAt: x.createdTimestamp,
            content: x.content,
          }))
      : [];

    const channelMeta = {
      guildName: m.guild?.name ?? '(unknown server)',
      channelName: 'name' in ch && typeof ch.name === 'string' ? ch.name : 'channel',
      channelTopic: 'topic' in ch && typeof ch.topic === 'string' ? ch.topic : null,
    };

    // Show "Bot is typing…" in Discord while Claude generates. The native
    // indicator expires after ~10s; refresh on an interval until done.
    const typingCh = ch as unknown as TypingChannel;
    void typingCh.sendTyping().catch(() => {});
    const typingInterval = setInterval(() => { void typingCh.sendTyping().catch(() => {}); }, 7000);

    let result;
    try {
      result = await autonomy.runAutonomous({
        guildId: m.guildId,
        channelId: m.channelId,
        channelMeta,
        history,
        target: {
          id: m.id,
          authorId: m.author.id,
          authorDisplayName: m.member?.displayName ?? m.author.globalName ?? m.author.username,
          isBot: false,
          createdAt: m.createdTimestamp,
          content: m.content,
        },
      });
    } finally {
      clearInterval(typingInterval);
    }

    if (!result.ok) return;

    try {
      const sent = await (ch as unknown as SendableChannel).send({ content: result.text, reply: { messageReference: m.id, failIfNotExists: false } });
      broadcast(MESSAGE_CREATE_CHANNEL, { channelId: sent.channelId, message: summarizeMessage(sent) });
    } catch {
      // no retry — avoid duplicate sends
    }
  };

  const isReplyTargetingBot = async (m: Message, botId: string): Promise<boolean> => {
    const refId = m.reference?.messageId;
    if (!refId) return false;
    try {
      const ref = await m.channel.messages.fetch(refId);
      return ref.author.id === botId;
    } catch {
      return false;
    }
  };

  const interval = setInterval(tryAttach, 1000);
  tryAttach();

  return () => {
    clearInterval(interval);
    const c = manager.getClient();
    if (c && bound) c.off(Events.MessageCreate, bound);
  };
}
