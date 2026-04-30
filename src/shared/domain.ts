export type GuildSummary = {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number | null;
};

export type ChannelKind =
  | 'text' | 'announcement' | 'forum' | 'voice' | 'category' | 'thread' | 'other';

export type ForumTag = {
  id: string;
  name: string;
  // Custom guild emoji ID (with name) or a unicode emoji char.
  emojiId: string | null;
  emojiName: string | null;
  emojiUnicode: string | null;
  moderated: boolean;
};

export type ForumPostSummary = {
  // The thread channel ID — clicking a post opens it as a normal thread.
  id: string;
  forumId: string;
  guildId: string;
  name: string;
  ownerId: string;
  ownerDisplayName: string | null;
  ownerAvatarUrl: string | null;
  ownerRoleColor: string | null;
  createdAt: number;
  lastActivityAt: number;
  messageCount: number;
  archived: boolean;
  locked: boolean;
  pinned: boolean;
  appliedTagIds: string[];
};

export type ForumChannelDetail = {
  forumId: string;
  guildId: string;
  name: string;
  topic: string | null;
  availableTags: ForumTag[];
  posts: ForumPostSummary[];
  // True when the forum is configured to require at least one tag per post.
  requireTag: boolean;
};

export type CreateForumPostPayload = {
  name: string;
  content: string;
  appliedTagIds: string[];
};

export type VoiceMemberSummary = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  roleColor: string | null;
  selfMute: boolean;
  selfDeaf: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
};

export type ChannelSummary = {
  id: string;
  guildId: string;
  name: string;
  type: ChannelKind;
  parentId: string | null;
  position: number;
  topic: string | null;
  // Populated only for voice channels. `null` everywhere else so consumers
  // don't need to special-case the field.
  voiceMembers: VoiceMemberSummary[] | null;
  // Discord snowflake of the most recent message in this channel, or null
  // if unknown. Used to detect "unread since last open" across restarts —
  // the renderer derives a timestamp from the snowflake and compares it
  // against the persisted `lastSeen` per channel.
  lastMessageId: string | null;
};

export type MessageAttachment = {
  id: string;
  name: string;
  url: string;
  size: number;
  contentType: string | null;
  width: number | null;
  height: number | null;
};

export type MessageEmbedSummary = {
  type: string | null;
  title: string | null;
  description: string | null;
  url: string | null;
  color: number | null;
  image: { url: string; width: number | null; height: number | null } | null;
  thumbnail: { url: string; width: number | null; height: number | null } | null;
  author: { name: string; url: string | null; iconUrl: string | null } | null;
  footer: { text: string; iconUrl: string | null } | null;
  provider: { name: string; url: string | null } | null;
  timestamp: number | null;
  video: { url: string; width: number | null; height: number | null } | null;
  fields: Array<{ name: string; value: string; inline: boolean }>;
};

export type ResolvedMention = { type: 'user' | 'channel' | 'role'; id: string; name: string };

export type ReactionSummary = {
  // Custom guild emoji ID, or null for unicode reactions.
  emojiId: string | null;
  // Unicode char for unicode reactions, or the custom emoji's name.
  emojiName: string;
  animated: boolean;
  count: number;
  // Whether the bot itself has reacted with this emoji.
  me: boolean;
};

export type GuildEmoji = {
  id: string;
  name: string;
  animated: boolean;
  guildId: string;
  url: string;
};

export type MemberSummary = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  roleColor: string | null;
};

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';

export type MemberRole = {
  id: string;
  name: string;
  color: string | null;
  position: number;
  iconUrl: string | null;
  unicodeEmoji: string | null;
};

export type MemberDetail = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  bannerColor: string | null;
  roleColor: string | null;
  status: PresenceStatus;
  isBot: boolean;
  joinedAt: number | null;
  createdAt: number;
  roles: MemberRole[];
  topRole: MemberRole | null;
};

export type RoleIcon = { roleId: string; roleName: string; iconUrl: string | null; unicodeEmoji: string | null };

export type ChannelMemberSummary = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  roleColor: string | null;
  status: PresenceStatus;
  topRole: { id: string; name: string; color: string | null; position: number; iconUrl: string | null; unicodeEmoji: string | null } | null;
  roleIcons: RoleIcon[];
};

export type SystemMessageKind =
  | 'user_join'
  | 'pin'
  | 'boost'
  | 'thread_create'
  | 'channel_follow'
  | 'recipient_add'
  | 'poll_result'
  | 'other';

export type PollResultSummary = {
  question: string;
  totalVotes: number;
  victorAnswerText: string | null;
  victorAnswerEmoji: string | null;
  victorAnswerVotes: number;
  tied: boolean;
};

export type PollVoter = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  roleColor: string | null;
};

export type PollSummary = {
  question: string;
  answers: Array<{ id: number; text: string; emoji: string | null; voteCount: number }>;
  totalVotes: number;
  allowMultiselect: boolean;
  expiresAt: number | null;
  resultsFinalized: boolean;
};

export type MessageSummary = {
  id: string;
  channelId: string;
  guildId: string | null;
  authorId: string;
  authorTag: string;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  authorRoleColor: string | null;
  authorTopRoleName: string | null;
  authorRoleIcons: RoleIcon[];
  authorIsBot: boolean;
  content: string;
  createdAt: number;
  editedAt: number | null;
  hasEmbeds: boolean;
  hasAttachments: boolean;
  attachments: MessageAttachment[];
  embeds: MessageEmbedSummary[];
  mentions: ResolvedMention[];
  mentionsEveryone: boolean;
  replyTo: {
    id: string;
    authorDisplayName: string | null;
    authorAvatarUrl: string | null;
    authorRoleColor: string | null;
    content: string | null;
    mentions: ResolvedMention[];
  } | null;
  systemKind: SystemMessageKind | null;
  poll: PollSummary | null;
  pollResult: PollResultSummary | null;
  reactions: ReactionSummary[];
  pinned: boolean;
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
  | { kind: 'connecting' }
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
  collapsedCategoryIds: string[];
  memberListOpen: boolean;
  channelLastSeen: Record<string, number>;
  mutedChannelIds: string[];
  giphyApiKey: string;
};

export type SendAttachment = {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type PollAnswer = { text: string; emoji?: string };

export type PollPayload = {
  question: string;
  answers: PollAnswer[];
  durationHours: number;
  allowMultiselect: boolean;
};

export type GuildRole = {
  id: string;
  name: string;
  color: string | null;        // "#rrggbb" or null
  position: number;
  managed: boolean;            // true for integration/bot-owned roles
  iconUrl: string | null;
  unicodeEmoji: string | null;
};

export type BotCapabilities = {
  canManageRoles: boolean;
  canKick: boolean;
  canBan: boolean;
  canTimeout: boolean;
  outranksTarget: boolean;
  botTopRolePosition: number;
  targetTopRolePosition: number;
  // Human-readable names of permissions the bot lacks (e.g., "Manage Roles").
  // Empty when the bot has all four moderation/role perms.
  missingPermissions: string[];
  // True when the target IS the bot itself — UI should hide self-actions.
  targetIsSelf: boolean;
};

export type AllMembersEntry = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  status: PresenceStatus;
  isBot: boolean;
  joinedAt: number | null;     // ms epoch — null if unknown
  createdAt: number;           // ms epoch
  roleColor: string | null;    // "#rrggbb" or null
  topRole: MemberRole | null;
  roleIds: string[];           // excluding @everyone
};

export type ListAllMembersResult = {
  entries: AllMembersEntry[];
  intentMissing: boolean;
};

export type BulkActionResult = {
  ok: string[];
  failed: Array<{ id: string; error: string }>;
};
