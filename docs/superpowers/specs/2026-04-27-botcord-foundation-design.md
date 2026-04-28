# BotCord Foundation — Design

**Date:** 2026-04-27
**Scope:** First-session foundation. Project scaffold, IPC contract, token vault, bot onboarding wizard, three-pane shell, embed composer route stub.
**Out of scope:** Voice, DMs, scheduled-post execution (queue scaffolding only), auto-updates, code signing, multi-bot support, billing, full embed composer UI.

## 1. Product Context

BotCord is a single-user desktop app that gives Discord server admins a nicer cockpit than the native client for tasks like composing rich embeds, bulk message management, and channel history browsing. It operates through the user's own Discord bot ("bring your own bot"). All bot operations happen locally; no server component.

Visually Discord-adjacent (three-pane layout) but with its own identity — no cloning of Discord colors or logos.

## 2. Architecture

### Process model

- **Main process (Node):** owns the token vault, the discord.js client, the SQLite database, and all IPC handlers.
- **Preload:** the only place that calls `contextBridge.exposeInMainWorld`. Exposes a typed `window.botcord` surface and nothing else.
- **Renderer (sandboxed):** React + Vite + Tailwind + shadcn/ui. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Has no Node, no `ipcRenderer`, no network access of its own.

### Security posture

- Token never reaches the renderer in any form. The renderer can ask the main process to *use* the token (e.g. send a message); it cannot read it.
- Token at rest: encrypted via Electron `safeStorage`, stored in `app.getPath('userData')/vault/token.bin`. `safeStorage` delegates to OS keychain (Keychain / DPAPI / libsecret).
- Renderer CSP: `default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; connect-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'`. Renderer makes zero outbound network calls; everything routes through main.
- `shell.openExternal` is allowlisted to `https://discord.com/*` and `https://cdn.discordapp.com/*`. The wizard uses it for the developer-portal links.
- Lint rule: `main/` cannot import from `renderer/` and vice versa. `shared/` is type-only at runtime.

### Stack

Electron + electron-vite, React 18, TypeScript (strict), Tailwind, shadcn/ui, TanStack Query, discord.js v14, better-sqlite3.

## 3. File / folder structure

```
botcord/
├── electron.vite.config.ts
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── components.json                 # shadcn config
├── src/
│   ├── main/
│   │   ├── index.ts                # app lifecycle, window mgmt, CSP, single-instance lock
│   │   ├── ipc/
│   │   │   ├── index.ts            # registers all handlers
│   │   │   ├── bot.ts              # token/setup/identity handlers
│   │   │   ├── guilds.ts
│   │   │   ├── messages.ts
│   │   │   └── system.ts
│   │   ├── vault/
│   │   │   ├── token-vault.ts      # safeStorage encrypt/decrypt + atomic file I/O
│   │   │   └── README.md           # threat model + audit notes
│   │   ├── discord/
│   │   │   ├── client-manager.ts   # getBotClient(), gateway lifecycle, reconnect tracking
│   │   │   ├── intents.ts          # required intents constant
│   │   │   └── permissions.ts      # invite URL builder, permission bitfield
│   │   ├── db/
│   │   │   ├── database.ts         # better-sqlite3 instance + migration runner
│   │   │   ├── migrations/001_init.sql
│   │   │   └── repos/{drafts,scheduled,prefs}.ts
│   │   └── events/
│   │       └── gateway-events.ts   # forwards ready/disconnect/error to renderer
│   ├── preload/
│   │   └── index.ts                # contextBridge exposure ONLY
│   ├── shared/
│   │   ├── ipc-contract.ts         # source of truth for the API surface
│   │   ├── domain.ts               # Guild, Channel, Message DTOs
│   │   └── errors.ts               # serializable error codes
│   └── renderer/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── routes/
│       │   ├── onboarding/         # bot setup wizard
│       │   ├── shell/              # three-pane layout
│       │   └── compose/            # embed composer stub
│       ├── components/ui/          # shadcn primitives
│       ├── components/             # app components (status pill, etc.)
│       ├── lib/
│       │   ├── api.ts              # thin wrapper around window.botcord
│       │   └── query-client.ts
│       └── styles/globals.css
└── resources/
    └── onboarding/                 # placeholder PNGs for wizard
```

## 4. IPC Contract

Source of truth: `src/shared/ipc-contract.ts`. Renderer accesses via `window.botcord`. Named operations only — no generic `invoke(channel, payload)` escape hatch.

### DTOs

```ts
export type GuildSummary = {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number | null;
};

export type ChannelSummary = {
  id: string;
  guildId: string;
  name: string;
  type: 'text' | 'announcement' | 'forum' | 'voice' | 'category' | 'thread' | 'other';
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
  createdAt: number;          // epoch ms
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
```

### Errors

```ts
export type IpcError = {
  code:
    | 'NOT_CONFIGURED'
    | 'INVALID_TOKEN'
    | 'MISSING_INTENTS'
    | 'MISSING_PERMISSIONS'
    | 'DISCORD_RATE_LIMITED'
    | 'DISCORD_HTTP_ERROR'
    | 'GATEWAY_OFFLINE'
    | 'NOT_FOUND'
    | 'INTERNAL';
  message: string;
  retryAfterMs?: number;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: IpcError };
```

### API surface

```ts
export interface BotcordApi {
  bot: {
    getStatus(): Promise<BotStatus>;
    validateToken(token: string): Promise<Result<BotIdentity>>;
    saveToken(token: string): Promise<Result<BotIdentity>>;
    clearToken(): Promise<Result<void>>;
    buildInviteUrl(clientId: string): Promise<Result<string>>;
  };
  guilds: {
    list(): Promise<Result<GuildSummary[]>>;
    listChannels(guildId: string): Promise<Result<ChannelSummary[]>>;
  };
  messages: {
    send(channelId: string, content: string): Promise<Result<MessageSummary>>;
    sendEmbed(channelId: string, embed: EmbedPayload, content?: string): Promise<Result<MessageSummary>>;
    history(channelId: string, opts: { before?: string; limit: number }): Promise<Result<MessageSummary[]>>;
    delete(channelId: string, messageId: string): Promise<Result<void>>;
    bulkDelete(channelId: string, messageIds: string[]): Promise<Result<{ deleted: string[] }>>;
  };
  drafts: {
    list(): Promise<Result<DraftRow[]>>;
    upsert(draft: DraftInput): Promise<Result<DraftRow>>;
    delete(id: string): Promise<Result<void>>;
  };
  prefs: {
    get<K extends keyof Prefs>(key: K): Promise<Result<Prefs[K]>>;
    set<K extends keyof Prefs>(key: K, value: Prefs[K]): Promise<Result<void>>;
  };
  events: {
    onBotStatus(cb: (s: BotStatus) => void): () => void;
    onGatewayState(cb: (s: GatewayState) => void): () => void;
    onGuildUpdate(cb: (g: GuildSummary) => void): () => void;
    onChannelUpdate(cb: (c: ChannelSummary) => void): () => void;
  };
  system: {
    appVersion(): Promise<string>;
    openExternal(url: string): Promise<void>;
  };
}
```

### IPC conventions

- All request handlers return `Result<T>` rather than throwing across the IPC boundary.
- History paging is renderer-driven via `before` cursor + `limit`. Matches Discord's REST shape and lets the UI show progress.
- Event subscriptions return an unsubscribe function. Preload manages the underlying `ipcRenderer.on` plumbing so the renderer never touches it.
- `system.openExternal` validates the URL against an allowlist (`discord.com`, `cdn.discordapp.com`) before delegating to `shell.openExternal`.

## 5. Token Vault

`src/main/vault/token-vault.ts` is small and self-contained for auditability. Public surface:

```ts
export interface TokenVault {
  hasToken(): boolean;
  saveToken(plaintext: string): Promise<void>;
  readToken(): Promise<string | null>;
  clear(): Promise<void>;
}
```

- Storage path: `app.getPath('userData')/vault/token.bin`. File contains the `safeStorage.encryptString` ciphertext only.
- Writes are atomic (write to `token.bin.tmp`, fsync, rename).
- File mode `0600` on Unix.
- On read, if `safeStorage.isEncryptionAvailable()` is false, throw a fatal error rather than silently degrading.
- The vault module never logs the plaintext, never returns it from any IPC handler, and never crosses the contextBridge.

`client-manager.ts` is the only consumer: it calls `readToken()` lazily when constructing the discord.js `Client`, then drops the reference. The plaintext lives only in the discord.js client's internal state.

## 6. Onboarding Wizard

Route: `/onboarding`. Five linear steps with placeholder image slots in `resources/onboarding/`:

1. **Create application** — link to `https://discord.com/developers/applications` via `system.openExternal`. Screenshot: "New Application" button.
2. **Create bot user** — screenshot of the Bot tab.
3. **Enable privileged intents** — screenshot showing Presence, Server Members, and Message Content toggles. Explains why each is needed.
4. **Generate invite URL** — user pastes their Application (Client) ID; we call `bot.buildInviteUrl(clientId)` to produce a URL with the bot's required permissions: `View Channels`, `Send Messages`, `Send Messages in Threads`, `Embed Links`, `Attach Files`, `Read Message History`, `Add Reactions`, `Manage Messages`, `Manage Threads`. The exact bitfield is computed in `permissions.ts` from this named list (no `Administrator` — least-privilege for admin tooling). User clicks through to invite the bot.
5. **Paste token** — masked input. On submit:
   1. `bot.validateToken(token)` calls `GET /users/@me`. Fast failure for malformed/revoked tokens.
   2. On success, `bot.saveToken(token)` persists via the vault and calls `client-manager.connect()`.
   3. If gateway connect fails with a disallowed-intents error, surface an `IpcError { code: 'MISSING_INTENTS' }` and route the user back to step 3 with an inline explanation. The token stays saved; user retries connect after fixing intents.

## 7. Discord Client Manager

`src/main/discord/client-manager.ts` owns the singleton discord.js `Client`.

- Intents: `Guilds`, `GuildMessages`, `MessageContent`, `GuildMembers`. Centralized in `intents.ts`.
- Lifecycle: `connect()` (called after successful `saveToken` and on app launch if token exists), `disconnect()` (called on `clearToken` and on app quit).
- Emits `GatewayState` transitions to the renderer via `events.onGatewayState`. State machine: `connecting` → `ready` | `disconnected`. Disconnects automatically attempt reconnect; each attempt bumps `attempt` counter and emits `reconnecting`.
- Cache-first reads: `guilds.list` and `guilds.listChannels` read from the discord.js gateway cache, not REST. This keeps data live and avoids rate-limit waste.
- REST writes (sendMessage / sendEmbed / delete / bulkDelete) wrap discord.js calls and translate errors to `IpcError`.

### Gateway lifecycle on window close (decided)

Close window = quit the app and disconnect the gateway. No tray-resident behavior this session. Revisit when scheduled-post execution lands.

### Status surfacing (decided)

Top-bar status pill bound to `events.onGatewayState`:

- Green "Connected" while `ready`.
- Yellow "Reconnecting (attempt N)" while `reconnecting`.
- Red "Disconnected — Retry" while `disconnected`. Clicking issues a manual reconnect.

Toast notification on each transition.

## 8. Three-Pane Shell

Route: `/`. Layout:

- **Left pane:** guild list. Avatar + name. Driven by `guilds.list()` + `events.onGuildUpdate` for live deltas.
- **Middle pane:** channel list for selected guild. Driven by `guilds.listChannels(guildId)` + `events.onChannelUpdate`. Categories collapse/expand; threads listed under parent.
- **Right pane:** placeholder this session. Header shows the selected channel name; body reads "Select an action — embed composer, history viewer, etc." Wires to `/compose` for the (stubbed) embed composer.

Top bar: app title, status pill, settings button (opens a panel with "Reset bot token" → `bot.clearToken`).

If `bot.getStatus()` returns `{ kind: 'unconfigured' }`, the app routes to `/onboarding` instead of the shell.

## 9. SQLite Schema

Migration `001_init.sql`:

```sql
CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  content TEXT,
  embed_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_drafts_updated ON drafts(updated_at DESC);

CREATE TABLE scheduled_posts (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  content TEXT,
  embed_json TEXT,
  scheduled_for INTEGER NOT NULL,
  status TEXT NOT NULL,                   -- 'pending' | 'sent' | 'failed' | 'canceled'
  last_error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX idx_scheduled_status_time ON scheduled_posts(status, scheduled_for);

CREATE TABLE prefs (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

Not in SQLite: the bot token (vault), guild/channel/message data (gateway cache), bot identity (single-bot session — derived from token).

DB location: `app.getPath('userData')/botcord.sqlite`. WAL mode enabled. Migration runner reads `schema_version`, applies any unapplied numbered SQL files in `migrations/` in order inside a transaction.

## 10. Embed Composer Stub

Route: `/compose`. Renders a single placeholder page reading "Embed composer — coming next session." No form scaffolding. The route exists so the router and shell linkage are in place.

## 11. CSP (decided)

```
default-src 'self';
img-src 'self' https://cdn.discordapp.com data:;
connect-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
```

`'unsafe-inline'` on styles is required for shadcn/Tailwind injected styles. Scripts stay strict. Renderer has no `connect-src` — all network goes through main.

## 12. Out-of-Scope This Session

- Full embed composer UI
- Scheduled-post execution (table exists; runner does not)
- Voice, DMs
- Multi-bot support
- Auto-updates, code signing
- Tray-resident background mode
- Settings beyond "Reset bot token"

## 13. Open Decisions Made

| # | Decision | Choice |
|---|----------|--------|
| 1 | Gateway on window close | Quit fully. No tray. |
| 2 | Disconnect surfacing | Status pill + toast on transitions |
| 3 | Token validation strategy | REST `/users/@me` first, then gateway connect; intent failures route back to wizard step 3 |
| 4 | Renderer CSP | Strict — `connect-src 'none'`, network only via main |
| 5 | `/compose` scope | Placeholder page only; no form |
