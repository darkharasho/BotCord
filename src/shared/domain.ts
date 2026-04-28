export type GuildSummary = {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number | null;
};

export type ChannelKind =
  | 'text' | 'announcement' | 'forum' | 'voice' | 'category' | 'thread' | 'other';

export type ChannelSummary = {
  id: string;
  guildId: string;
  name: string;
  type: ChannelKind;
  parentId: string | null;
  position: number;
  topic: string | null;
};

export type MessageSummary = {
  id: string;
  channelId: string;
  authorId: string;
  authorTag: string;
  content: string;
  createdAt: number;
  editedAt: number | null;
  hasEmbeds: boolean;
  hasAttachments: boolean;
};

export type EmbedPayload = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  footer?: { text: string; iconUrl?: string };
  author?: { name: string; url?: string; iconUrl?: string };
  thumbnail?: { url: string };
  image?: { url: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
};

export type BotIdentity = {
  id: string;
  username: string;
  discriminator: string;
  avatarUrl: string | null;
};

export type GatewayState =
  | { status: 'connecting' }
  | { status: 'ready'; sessionStartedAt: number }
  | { status: 'reconnecting'; attempt: number; lastError: string | null }
  | { status: 'disconnected'; reason: string | null };

export type BotStatus =
  | { kind: 'unconfigured' }
  | { kind: 'configured'; identity: BotIdentity; gateway: GatewayState };

export type DraftRow = {
  id: string;
  name: string;
  guildId: string | null;
  channelId: string | null;
  content: string | null;
  embed: EmbedPayload | null;
  createdAt: number;
  updatedAt: number;
};

export type DraftInput = Omit<DraftRow, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export type Prefs = {
  lastSelectedGuildId: string | null;
  lastSelectedChannelId: string | null;
  theme: 'dark';
};
