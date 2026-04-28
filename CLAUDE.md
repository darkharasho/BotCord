## Project Context

BotCord is a desktop admin cockpit for Discord that operates through a user's own bot ("bring your own bot"). It gives server admins a nicer UI than Discord's native client for tasks like composing rich embeds, bulk message management, and browsing channel history — all executed via their bot's token. Stack: Electron + React + TypeScript, SQLite for local persistence, discord.js for bot operations. Tokens are stored locally and encrypted via the OS keychain (Keytar / safeStorage). Visually Discord-adjacent (three-pane layout) but with its own identity, not a clone.
