import type { CDKEvent } from '@claude-cdk/core';
import type { GuildAutonomyConfig, GlobalAutonomyConfig } from '../../shared/domain';

export type AutonomyDeps = {
  host: AutonomyHost;
  globalConfig: () => GlobalAutonomyConfig;
  guildConfig: (guildId: string) => GuildAutonomyConfig;
  now?: () => number;
};

export interface AutonomyHost {
  detect(): Promise<{ found: boolean; version?: string; reason?: string }>;
  startSession(opts: { cwd: string; model?: string }): Promise<AutonomySession>;
}

export interface AutonomySession {
  send(prompt: string): AsyncIterable<CDKEvent>;
  abort(): Promise<void>;
  close(): Promise<void>;
}

export type ChannelHistoryEntry = {
  authorId: string;
  authorDisplayName: string;
  isBot: boolean;
  createdAt: number;
  content: string;
};

export type PromptInputs = {
  systemPrompt: string;
  channelMeta: { guildName: string; channelName: string; channelTopic: string | null };
  history: ChannelHistoryEntry[];
  target: ChannelHistoryEntry & { id: string };
};
