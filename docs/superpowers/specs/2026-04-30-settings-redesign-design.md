# Settings Redesign — Discord-Inspired Sidebar Layout

**Date:** 2026-04-30
**Status:** Approved (pending implementation plan)

## Goal

Replace BotCord's current single-panel settings modal with a fullscreen, sidebar-driven settings UI inspired by Discord's settings page. Consolidate all global and per-guild configuration into one place.

## Scope

In scope:

- Rehouse every existing setting (invite, GIPHY key, global autonomy, close-to-tray, reset token).
- Add an "About" section (app version, GitHub link, license).
- Move per-guild Autonomy from the server-rail right-click menu into the new settings UI under a "Servers" section.
- Add empty placeholder sections (Appearance, Notifications) so the structure is in place for future additions.

Out of scope:

- Implementing a theme system (the Appearance section ships as a "Coming soon" card).
- New notification toggles beyond the existing close-to-tray.
- Keyboard navigation inside the sidebar beyond Esc-to-close.
- Global settings search.

## User Experience

### Presentation

Fullscreen overlay layered above the main shell. Opens via the existing gear icon in `BotIdentityFooter`. Closes via:

- Top-right `X` button.
- `Esc` keypress.
- Click outside the overlay (preserves current behavior).

Closing returns the user to whatever they were doing — overlay state only, no route change.

### Layout

- Left **240px sidebar** (sectioned nav, scrollable independently).
- Right content area fills the remaining width.
- Both panes share the overlay's vertical scroll boundary.

### Sidebar structure

```
USER SETTINGS
  Account
  Connections

APP SETTINGS
  Appearance
  Notifications
  Autonomy
  Servers
  About

────────────────
[ Reset Bot Token ]   ← danger-styled button pinned to the bottom
```

- Section headers are uppercase muted labels.
- Active item gets the accent-color background (matches the existing accent treatment elsewhere in the app).
- "Reset Bot Token" lives at the sidebar bottom in danger styling, mirroring Discord's "Log Out" placement.

### Right-pane sections

| Section       | Content                                                                                                                                                              |
|---------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Account       | Bot avatar, username, ID. "Invite to a new server" button (existing flow). Read-only summary of currently-enabled intents.                                           |
| Connections   | GIPHY API key field with existing help text. Layout designed so future integrations (e.g. OpenAI key) drop in as additional rows.                                    |
| Appearance    | Single empty card: "Theme customization coming soon." Placeholder slot only.                                                                                         |
| Notifications | "Minimize to system tray on close" toggle (existing). Room reserved for future toggles.                                                                              |
| Autonomy      | Wraps the existing `<GlobalAutonomySettings />` component unchanged.                                                                                                 |
| Servers       | Searchable guild list (avatar + name + member count). Selecting a guild swaps the right pane to that guild's autonomy panel with a header `← Servers / <GuildName>`. Reuses `<AutonomySettingsTab guildId={...} />`. |
| About         | App name, version (from `package.json`), Electron/Node versions, GitHub link, license.                                                                               |

### Servers drilldown

Two states inside the Servers section:

1. **List state** — search input + list of guilds. List items reuse `GuildSummary` data already in renderer state.
2. **Detail state** — selected guild's autonomy panel. Header shows breadcrumb `← Servers / <GuildName>`; clicking the back link returns to list state.

The selected guild is component-local state inside `ServersSection`; reopening the overlay resets to list state.

## Architecture

### File layout

```
src/renderer/components/settings/
  SettingsOverlay.tsx        Root: backdrop, X close, Esc handler, sidebar + content router
  SettingsSidebar.tsx        Nav items, section headers, danger button
  sections/
    AccountSection.tsx
    ConnectionsSection.tsx
    AppearanceSection.tsx
    NotificationsSection.tsx
    AutonomySection.tsx      Thin wrapper around GlobalAutonomySettings
    ServersSection.tsx       Guild picker + AutonomySettingsTab drilldown
    AboutSection.tsx
```

### State

- `SettingsOverlay` owns the active sidebar item via `useState<SectionId>('account')`.
- `ServersSection` owns the selected guild via `useState<GuildSummary | null>(null)`.
- All persisted settings continue to use the existing `api.prefs` channel — no new IPC contracts.

### Reused components

- `<GlobalAutonomySettings />` — embedded inside `AutonomySection`.
- `<AutonomySettingsTab guildId={...} />` — embedded inside `ServersSection` when a guild is selected.
- `<CheckBox />` — used in `NotificationsSection`.

### Removed components / behavior

- `src/renderer/components/SettingsPanel.tsx` — deleted; `SettingsOverlay` replaces it entirely.
- `ServerRail.tsx`: the right-click "Autonomy settings" entry and the embedded `AutonomySettingsTab` modal are removed. The new "Mark as read" entry (just shipped in v0.3.7) stays. Settings → Servers is the only home for per-guild autonomy.
- `ShellRoute.tsx`: `<SettingsPanel onClose=… />` is replaced with `<SettingsOverlay onClose=… />`. The `settingsOpen` state stays as-is.

### About section data sources

- `app version` — read from `package.json` (already exposed via `api.system` or via build-time inlining; verify during implementation).
- Electron / Node versions — `process.versions` available in the renderer via `window.botcord` or hardcoded at build time.
- GitHub link — static `https://github.com/darkharasho/BotCord`.

If a clean version-exposure path doesn't exist yet, the implementation plan adds a small `api.system.getVersionInfo()` IPC method.

## Visual Style

- Matches the existing app palette: `bg-bg-sunken` for the sidebar, `bg-bg-subtle` for the content area, accent for active items.
- Section headings inside content panels use the same typography hierarchy as the rest of the shell.
- Form fields, toggles, and danger buttons reuse existing classnames and the existing `<CheckBox />` component — no new design tokens.

## Testing

- Unit-render tests for each section to confirm it mounts and reads its current pref / data source.
- A smoke test for `SettingsOverlay` covering: open → click each sidebar item → content swap → Esc closes.
- A smoke test for `ServersSection`: select a guild → autonomy panel appears with correct `guildId` → back link returns to list.

## Migration / Rollout

No data migration. All existing prefs keys (`giphyApiKey`, `closeToTray`, autonomy settings) are read by the new components unchanged. Users see the new UI immediately on next launch.

## Open Questions

None at design time — every decision above was confirmed during brainstorming.
