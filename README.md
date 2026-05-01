<p align="center">
  <img src="public/botcord-icon.png" alt="BotCord Logo" width="180" />
</p>

<h1 align="center">BotCord — Discord, but for your bot</h1>

<p align="center">
  <strong>A desktop admin cockpit that drives Discord through <em>your</em> bot.</strong>
</p>

<p align="center">
  <a href="https://github.com/darkharasho/BotCord/releases/latest"><img src="https://img.shields.io/github/v/release/darkharasho/BotCord?style=flat-square&color=5865F2" alt="Latest Release" /></a>
  <a href="https://github.com/darkharasho/BotCord/blob/master/LICENSE"><img src="https://img.shields.io/github/license/darkharasho/BotCord?style=flat-square" alt="License" /></a>
  <a href="https://github.com/darkharasho/BotCord/releases"><img src="https://img.shields.io/github/downloads/darkharasho/BotCord/total?style=flat-square&color=5865F2" alt="Downloads" /></a>
</p>

---

## Stop fighting the Discord client. Start running your server.

BotCord is a desktop admin tool that operates through a Discord bot you already own. Paste your bot's token, invite it to your server, and BotCord gives you a clean three-pane workspace — channels on the left, conversation in the middle, members on the right — with tools the official client doesn't bother to ship: a real embed composer, bulk message management, draft library, member directory with moderation actions, and an autonomous reply mode powered by your local Claude CLI.

Bring your own bot. Bring your own credentials. Nothing leaves your machine that you didn't authorize.

---

## Features

### Bring your own bot
Paste a Discord bot token once. It's encrypted to the OS keychain (libsecret / Keychain / DPAPI via Electron's `safeStorage`) and never leaves your machine. The app validates the token, surfaces missing intents and permissions clearly, and connects through the standard discord.js gateway — no proxy, no third-party server.

### Discord-faithful three-pane UI
Server rail, channel list, message stream, member list, reply previews, reactions, mentions, embeds, polls, stickers, GIFs, custom emoji — all rendered the way you expect. Right-click any message for the full action surface; right-click any member for moderation tools.

### Autonomous reply mode (powered by Claude)
Opt-in per channel. When the bot is `@mentioned` or replied to in an allowlisted channel, BotCord generates a contextual response through your local `claude` CLI and sends it. Per-guild personas, configurable context window, per-channel cooldowns, global rate cap, queue with TTL, and a kill switch in the footer. Optional vision support sends image attachments to Claude as actual visual input. No API keys stored — auth flows through your already-installed CLI.

### "Generate reply with Claude" — manual draft
Right-click any message → "Generate reply with Claude". Streams the draft directly into the composer with the source message wired up as the reply target, so you review, edit, and hit send yourself. The bot only posts what you approve.

### Rich message composer
Real embed builder with title/description/fields/footer/timestamp/colors. Attach files, polls, custom guild emoji, mentions with autocomplete. Save drafts to a library and reuse them across servers.

### Bulk message management
Multi-select messages and delete in bulk (within Discord's 2-week window), bulk-react, edit your bot's own messages inline, or pin/unpin from the right-click menu.

### Member directory with moderation
A searchable, sortable, role-filterable view of every member in a guild. Multi-select to bulk-assign roles, kick, ban, or timeout — with full reason fields and progress reporting per action.

### Forum & thread support
Browse forum channels with applied tags, archived posts, and per-post member context. Reply to forum posts with the same composer you use everywhere else.

### Voice channel awareness
See who's in a voice channel at a glance, including mute/deafen state, all updated live from the gateway.

### System tray integration
Close the window and BotCord stays running in your system tray. The tray icon shows a red-dot badge while any unmuted channel has unread messages, and the right-click menu lets you toggle autonomy or quit without bringing the window back.

### Self-updating, self-contained
Auto-update via electron-updater pulls fresh AppImage/exe/dmg builds as they ship. SQLite persists drafts, prefs, and per-guild autonomy config locally. No cloud, no account.

---

## Quick start

### Download

Grab the latest release for your platform:

- **Linux** — [AppImage](https://github.com/darkharasho/BotCord/releases/latest)
- **Windows** — [Installer](https://github.com/darkharasho/BotCord/releases/latest)
- **macOS** — [DMG / ZIP](https://github.com/darkharasho/BotCord/releases/latest)

### Prerequisites

You need a Discord bot you control:

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications).
2. Enable the **Server Members**, **Message Content**, and **Presence** privileged intents on the *Bot* tab.
3. Copy the bot token. BotCord will ask for it on first launch.
4. Use BotCord's "Invite bot to a new server" button (in Settings) to generate an invite URL with sensible default permissions.

Optional, for autonomous reply mode:

- **Claude CLI** — [docs.claude.com](https://docs.claude.com/en/docs/claude-code) installed and authenticated. Autonomy settings show a banner if the CLI isn't found.

### Build from source

```bash
git clone https://github.com/darkharasho/BotCord.git
cd BotCord
npm install
npm run dev              # development
npm run dist:linux       # build AppImage
npm run dist:win         # build Windows installer
npm run dist:mac         # build macOS dmg/zip
```

---

## Tech stack

| Layer       | Technology                              |
|-------------|-----------------------------------------|
| Framework   | Electron 33                             |
| Frontend    | React 18, TypeScript 5.6, Vite 5        |
| Bot gateway | discord.js 14                           |
| Persistence | better-sqlite3 11 (WAL mode)            |
| Autonomy    | @claude-cdk/core (local Claude CLI)     |
| Updates     | electron-updater                        |
| UI          | Tailwind, Tabler Icons, react-window    |
| Voice       | @discordjs/voice + @discordjs/opus      |

---

## Contributing

Contributions welcome. Fork, branch, PR.

```bash
git checkout -b my-feature
# make your changes
npm run typecheck        # type-check both bundles
npm test                 # run the suite
npm run dist             # full build
```

The codebase is split into `src/main` (Electron main process — bot gateway, IPC handlers, SQLite, autonomy module), `src/preload` (context bridge), `src/renderer` (React shell), and `src/shared` (typed IPC contract + domain types).

---

## License

See [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Built for Discord admins who'd rather ship than wrangle.</sub>
</p>
