# Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-panel settings modal with a Discord-inspired fullscreen overlay containing a sectioned sidebar nav, and consolidate per-guild Autonomy from the server-rail right-click into the new settings UI.

**Architecture:** A `SettingsOverlay` root component owns the active section state and renders a `SettingsSidebar` plus the section component for the active item. Each section is a focused, self-contained component under `src/renderer/components/settings/sections/`. Existing `<GlobalAutonomySettings />` and `<AutonomySettingsTab />` are wrapped/embedded unchanged. The old `SettingsPanel.tsx` is deleted; the right-click "Autonomy settings" entry on the server rail is removed.

**Tech Stack:** React 18 + TypeScript, Tailwind, vitest + @testing-library/react. All persistence goes through the existing `api.prefs` IPC channel; `api.system.appVersion()` already exists for the About section. No new IPC handlers required.

**Spec:** `docs/superpowers/specs/2026-04-30-settings-redesign-design.md`

---

## File Structure

**New files:**
- `src/renderer/components/settings/SettingsOverlay.tsx` — root: backdrop, X close, Esc handler, sidebar + active section
- `src/renderer/components/settings/SettingsSidebar.tsx` — nav items, section headers, danger button
- `src/renderer/components/settings/types.ts` — `SectionId` union and nav config
- `src/renderer/components/settings/sections/AccountSection.tsx`
- `src/renderer/components/settings/sections/ConnectionsSection.tsx`
- `src/renderer/components/settings/sections/AppearanceSection.tsx`
- `src/renderer/components/settings/sections/NotificationsSection.tsx`
- `src/renderer/components/settings/sections/AutonomySection.tsx` — wraps `GlobalAutonomySettings`
- `src/renderer/components/settings/sections/ServersSection.tsx` — guild picker → embeds `AutonomySettingsTab`
- `src/renderer/components/settings/sections/AboutSection.tsx`
- `src/renderer/components/settings/__tests__/SettingsOverlay.test.tsx`
- `src/renderer/components/settings/__tests__/ServersSection.test.tsx`

**Modified files:**
- `src/renderer/routes/shell/ShellRoute.tsx` — swap `<SettingsPanel />` for `<SettingsOverlay />`
- `src/renderer/components/ServerRail.tsx` — remove "Autonomy settings" right-click entry, the autonomy modal, and the `setAutonomyModalForGuild` state

**Deleted files:**
- `src/renderer/components/SettingsPanel.tsx`

---

## Task 1: Add the section types and nav config

**Files:**
- Create: `src/renderer/components/settings/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/renderer/components/settings/types.ts
export type SectionId =
  | 'account'
  | 'connections'
  | 'appearance'
  | 'notifications'
  | 'autonomy'
  | 'servers'
  | 'about';

export type NavGroup = {
  label: string;
  items: { id: SectionId; label: string }[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'User Settings',
    items: [
      { id: 'account', label: 'Account' },
      { id: 'connections', label: 'Connections' },
    ],
  },
  {
    label: 'App Settings',
    items: [
      { id: 'appearance', label: 'Appearance' },
      { id: 'notifications', label: 'Notifications' },
      { id: 'autonomy', label: 'Autonomy' },
      { id: 'servers', label: 'Servers' },
      { id: 'about', label: 'About' },
    ],
  },
];

export const DEFAULT_SECTION: SectionId = 'account';
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/types.ts
git commit -m "feat(settings): add section types and nav config scaffold"
```

---

## Task 2: AppearanceSection (placeholder — simplest section, builds the pattern)

**Files:**
- Create: `src/renderer/components/settings/sections/AppearanceSection.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/renderer/components/settings/sections/AppearanceSection.tsx
export function AppearanceSection() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-fg">Appearance</h2>
      <div className="rounded border border-border bg-bg-sunken px-4 py-6 text-sm text-fg-muted">
        Theme customization coming soon.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/sections/AppearanceSection.tsx
git commit -m "feat(settings): add Appearance placeholder section"
```

---

## Task 3: AutonomySection (wraps existing GlobalAutonomySettings)

**Files:**
- Create: `src/renderer/components/settings/sections/AutonomySection.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/renderer/components/settings/sections/AutonomySection.tsx
import { GlobalAutonomySettings } from '../../GlobalAutonomySettings';

export function AutonomySection() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-fg">Autonomy</h2>
      <GlobalAutonomySettings />
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/sections/AutonomySection.tsx
git commit -m "feat(settings): add Autonomy section wrapping GlobalAutonomySettings"
```

---

## Task 4: NotificationsSection (close-to-tray toggle moved out of SettingsPanel)

**Files:**
- Create: `src/renderer/components/settings/sections/NotificationsSection.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/renderer/components/settings/sections/NotificationsSection.tsx
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { CheckBox } from '../../CheckBox';

export function NotificationsSection() {
  const [closeToTray, setCloseToTray] = useState<boolean | null>(null);

  useEffect(() => {
    api.prefs.get('closeToTray').then(res => {
      setCloseToTray(res.ok && typeof res.data === 'boolean' ? res.data : true);
    });
  }, []);

  if (closeToTray === null) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-fg">Notifications</h2>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <CheckBox
          checked={closeToTray}
          onChange={() => {
            const next = !closeToTray;
            setCloseToTray(next);
            api.prefs.set('closeToTray', next);
          }}
          ariaLabel="Minimize to tray on close"
        />
        <span>
          Minimize to system tray on close
          <span className="block text-[11px] text-fg-muted">
            When off, clicking the close button quits BotCord. macOS uses the dock and ignores this.
          </span>
        </span>
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/sections/NotificationsSection.tsx
git commit -m "feat(settings): add Notifications section with close-to-tray toggle"
```

---

## Task 5: ConnectionsSection (GIPHY API key)

**Files:**
- Create: `src/renderer/components/settings/sections/ConnectionsSection.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/renderer/components/settings/sections/ConnectionsSection.tsx
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

export function ConnectionsSection() {
  const [giphyKey, setGiphyKey] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.prefs.get('giphyApiKey').then(res => {
      if (res.ok && typeof res.data === 'string') setGiphyKey(res.data);
      setLoaded(true);
    });
  }, []);

  // Persist on every change after the initial load. Typing doesn't hit the
  // network — only writes to prefs — so no debounce needed.
  useEffect(() => {
    if (!loaded) return;
    api.prefs.set('giphyApiKey', giphyKey);
  }, [giphyKey, loaded]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-fg">Connections</h2>
      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">GIPHY API key</label>
        <input
          type="password"
          value={giphyKey}
          onChange={(e) => setGiphyKey(e.target.value)}
          placeholder="Paste your GIPHY developer key"
          className="w-full px-3 py-2 rounded bg-bg-sunken border border-border text-fg text-sm outline-none focus:border-accent"
        />
        <p className="text-[11px] text-fg-dim leading-relaxed">
          Required for the GIF picker. Get a free key at <span className="text-accent">developers.giphy.com</span>. Stored locally only.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/sections/ConnectionsSection.tsx
git commit -m "feat(settings): add Connections section with GIPHY key field"
```

---

## Task 6: AccountSection (bot identity, invite, intents summary)

**Files:**
- Create: `src/renderer/components/settings/sections/AccountSection.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/renderer/components/settings/sections/AccountSection.tsx
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import type { BotIdentity } from '../../../../shared/domain';
import { pushToast } from '../../Toaster';

const INTENT_LABELS = [
  'Guilds',
  'Guild Messages',
  'Message Content',
  'Guild Members',
  'Guild Presences',
  'Voice States',
  'Reactions',
  'Polls',
  'Typing',
];

export function AccountSection() {
  const [identity, setIdentity] = useState<BotIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  useEffect(() => {
    api.bot.getStatus().then(s => {
      if (s.kind === 'configured') setIdentity(s.identity);
    });
  }, []);

  const invite = async () => {
    setBusy(true);
    const status = await api.bot.getStatus();
    if (status.kind !== 'configured') {
      pushToast('warn', 'Bot must be connected to generate an invite');
      setBusy(false);
      return;
    }
    const res = await api.bot.buildInviteUrl(status.identity.id);
    setBusy(false);
    if (!res.ok) {
      pushToast('danger', `Couldn't build invite: ${res.error.message}`);
      return;
    }
    setInviteUrl(res.data);
    api.system.openExternal(res.data);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-fg">Account</h2>

      {identity && (
        <div className="flex items-center gap-3">
          <img src={identity.avatarUrl} alt="" className="w-16 h-16 rounded-full" />
          <div>
            <div className="text-base font-semibold text-fg">{identity.username}</div>
            <div className="text-xs text-fg-muted">ID: {identity.id}</div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <button
          className="px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
          onClick={invite}
          disabled={busy}
        >
          Invite bot to a new server
        </button>
        {inviteUrl && (
          <div className="text-xs text-fg-muted space-y-1">
            <div>Opened in your browser. Pick a server, then approve.</div>
            <code
              className="block break-all bg-bg-sunken border border-border rounded px-2 py-1 text-fg cursor-pointer hover:bg-hover"
              onClick={() => { navigator.clipboard.writeText(inviteUrl); pushToast('ok', 'Invite URL copied'); }}
              title="Click to copy"
            >
              {inviteUrl}
            </code>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-fg">Required intents</h3>
        <p className="text-[11px] text-fg-muted">
          BotCord requests these gateway intents. Configure them in your bot's Discord developer portal.
        </p>
        <ul className="text-xs text-fg-muted grid grid-cols-2 gap-1">
          {INTENT_LABELS.map(name => (
            <li key={name} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-ok" />
              {name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/sections/AccountSection.tsx
git commit -m "feat(settings): add Account section with identity, invite, intents"
```

---

## Task 7: AboutSection (version + GitHub link)

**Files:**
- Create: `src/renderer/components/settings/sections/AboutSection.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/renderer/components/settings/sections/AboutSection.tsx
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

const GITHUB_URL = 'https://github.com/darkharasho/BotCord';

export function AboutSection() {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    api.system.appVersion().then(setVersion);
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-fg">About</h2>

      <div className="space-y-1">
        <div className="text-2xl font-semibold text-fg">BotCord</div>
        <div className="text-sm text-fg-muted">Version {version || '—'}</div>
      </div>

      <div className="space-y-2 text-sm">
        <button
          onClick={() => api.system.openExternal(GITHUB_URL)}
          className="text-accent hover:text-accent-hover underline"
        >
          GitHub repository
        </button>
      </div>

      <p className="text-[11px] text-fg-dim leading-relaxed max-w-md">
        BotCord is a desktop admin cockpit for Discord that operates through your own bot. Tokens are stored locally and encrypted via the OS keychain.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/sections/AboutSection.tsx
git commit -m "feat(settings): add About section"
```

---

## Task 8: ServersSection (guild picker + per-guild autonomy drilldown)

**Files:**
- Create: `src/renderer/components/settings/sections/ServersSection.tsx`
- Create: `src/renderer/components/settings/__tests__/ServersSection.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/components/settings/__tests__/ServersSection.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServersSection } from '../sections/ServersSection';

vi.mock('../../../lib/api', () => ({
  api: {
    guilds: {
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          { id: 'g1', name: 'Alpha', iconUrl: null, memberCount: 42 },
          { id: 'g2', name: 'Bravo', iconUrl: null, memberCount: 7 },
        ],
      }),
      listChannels: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    },
    autonomy: {
      detect: vi.fn().mockResolvedValue({ found: true }),
      getGuildConfig: vi.fn().mockResolvedValue({
        ok: true,
        data: { guildId: 'g1', enabled: false, channelIds: [], contextSize: 20, systemPrompt: null, cooldownMs: 5000, updatedAt: 0 },
      }),
      setGuildConfig: vi.fn(),
    },
    events: {
      onGuildUpdate: () => () => {},
      onGatewayState: () => () => {},
    },
  },
}));

describe('ServersSection', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the guild list, then drills into a selected guild', async () => {
    render(<ServersSection />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Alpha'));

    await waitFor(() => {
      expect(screen.getByText(/← Servers/)).toBeInTheDocument();
    });
    expect(screen.getByText('Alpha', { selector: 'span,div,h2' })).toBeTruthy();
  });

  it('back link returns to the guild list', async () => {
    render(<ServersSection />);
    fireEvent.click(await screen.findByText('Alpha'));
    fireEvent.click(await screen.findByText(/← Servers/));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search servers/i)).toBeInTheDocument();
    });
  });

  it('filters guilds by search query', async () => {
    render(<ServersSection />);
    await screen.findByText('Alpha');
    fireEvent.change(screen.getByPlaceholderText(/search servers/i), { target: { value: 'brav' } });
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/components/settings/__tests__/ServersSection.test.tsx`
Expected: FAIL — `Cannot find module '../sections/ServersSection'`.

- [ ] **Step 3: Implement the component**

```tsx
// src/renderer/components/settings/sections/ServersSection.tsx
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import type { GuildSummary } from '../../../../shared/domain';
import { AutonomySettingsTab } from '../../AutonomySettingsTab';
import { IconSearch, IconChevronRight } from '@tabler/icons-react';

export function ServersSection() {
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [selected, setSelected] = useState<GuildSummary | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await api.guilds.list();
      if (!active) return;
      if (res.ok) setGuilds(res.data);
    };
    load();
    const unsub = api.events.onGuildUpdate(() => load());
    return () => { active = false; unsub(); };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return guilds;
    return guilds.filter(g => g.name.toLowerCase().includes(q));
  }, [guilds, query]);

  if (selected) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelected(null)}
          className="text-sm text-fg-muted hover:text-fg"
        >
          ← Servers / <span className="text-fg">{selected.name}</span>
        </button>
        <h2 className="text-xl font-semibold text-fg">{selected.name}</h2>
        <AutonomySettingsTab guildId={selected.id} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-fg">Servers</h2>
      <p className="text-sm text-fg-muted">Configure per-server autonomy settings.</p>

      <div className="rounded border border-border bg-bg-sunken">
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <IconSearch size={14} stroke={2} className="text-fg-dim shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search servers"
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-dim min-w-0"
          />
        </div>
        <div className="max-h-[28rem] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-xs text-fg-muted text-center">
              {guilds.length === 0 ? 'No servers' : `No servers match "${query}"`}
            </div>
          )}
          {filtered.map(g => (
            <button
              key={g.id}
              onClick={() => setSelected(g)}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-hover text-left border-b border-border last:border-b-0"
            >
              {g.iconUrl
                ? <img src={g.iconUrl} alt="" className="w-8 h-8 rounded-full" />
                : <div className="w-8 h-8 rounded-full bg-bg-subtle flex items-center justify-center text-xs font-semibold text-fg">{g.name.slice(0, 2).toUpperCase()}</div>
              }
              <div className="flex-1 min-w-0">
                <div className="text-sm text-fg truncate">{g.name}</div>
                {g.memberCount !== null && (
                  <div className="text-[11px] text-fg-muted">{g.memberCount.toLocaleString()} members</div>
                )}
              </div>
              <IconChevronRight size={14} className="text-fg-muted shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/components/settings/__tests__/ServersSection.test.tsx`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/sections/ServersSection.tsx src/renderer/components/settings/__tests__/ServersSection.test.tsx
git commit -m "feat(settings): add Servers section with guild picker and autonomy drilldown"
```

---

## Task 9: SettingsSidebar

**Files:**
- Create: `src/renderer/components/settings/SettingsSidebar.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/renderer/components/settings/SettingsSidebar.tsx
import { NAV_GROUPS, type SectionId } from './types';

export function SettingsSidebar({
  active, onSelect, onResetToken,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  onResetToken: () => void;
}) {
  return (
    <nav className="w-60 shrink-0 h-full bg-bg-sunken border-r border-border flex flex-col">
      <div className="flex-1 overflow-y-auto py-6 px-3">
        {NAV_GROUPS.map(group => (
          <div key={group.label} className="mb-6">
            <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
              {group.label}
            </div>
            <ul>
              {group.items.map(item => (
                <li key={item.id}>
                  <button
                    onClick={() => onSelect(item.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                      active === item.id
                        ? 'bg-accent text-white'
                        : 'text-fg hover:bg-hover'
                    }`}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-3">
        <button
          onClick={onResetToken}
          className="w-full px-3 py-2 rounded border border-danger/50 text-danger text-sm hover:bg-danger/10"
        >
          Reset Bot Token
        </button>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/SettingsSidebar.tsx
git commit -m "feat(settings): add SettingsSidebar with section nav and danger button"
```

---

## Task 10: SettingsOverlay (root composition)

**Files:**
- Create: `src/renderer/components/settings/SettingsOverlay.tsx`
- Create: `src/renderer/components/settings/__tests__/SettingsOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/components/settings/__tests__/SettingsOverlay.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SettingsOverlay } from '../SettingsOverlay';

vi.mock('../../../lib/api', () => ({
  api: {
    bot: { getStatus: vi.fn().mockResolvedValue({ kind: 'unconfigured' }), clearToken: vi.fn(), buildInviteUrl: vi.fn() },
    prefs: { get: vi.fn().mockResolvedValue({ ok: true, data: true }), set: vi.fn() },
    guilds: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }), listChannels: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
    autonomy: { detect: vi.fn().mockResolvedValue({ found: true }), getGlobalConfig: vi.fn().mockResolvedValue({ ok: true, data: null }), getGuildConfig: vi.fn(), setGuildConfig: vi.fn(), setGlobalConfig: vi.fn() },
    system: { appVersion: vi.fn().mockResolvedValue('0.3.7'), openExternal: vi.fn() },
    events: {
      onBotStatus: () => () => {},
      onGatewayState: () => () => {},
      onGuildUpdate: () => () => {},
      onGlobalAutonomy: () => () => {},
    },
  },
}));

vi.mock('../../GlobalAutonomySettings', () => ({
  GlobalAutonomySettings: () => <div>global-autonomy-stub</div>,
}));

const renderOverlay = (onClose = vi.fn()) =>
  render(<MemoryRouter><SettingsOverlay onClose={onClose} /></MemoryRouter>);

describe('SettingsOverlay', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders Account by default', async () => {
    renderOverlay();
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });

  it('switches sections when sidebar items are clicked', async () => {
    renderOverlay();
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    expect(await screen.findByRole('heading', { name: 'About' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    expect(await screen.findByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
  });

  it('closes on Esc keypress', () => {
    const onClose = vi.fn();
    renderOverlay(onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when X button is clicked', () => {
    const onClose = vi.fn();
    renderOverlay(onClose);
    fireEvent.click(screen.getByLabelText('Close settings'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/components/settings/__tests__/SettingsOverlay.test.tsx`
Expected: FAIL — `Cannot find module '../SettingsOverlay'`.

- [ ] **Step 3: Implement the component**

```tsx
// src/renderer/components/settings/SettingsOverlay.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconX } from '@tabler/icons-react';
import { api } from '../../lib/api';
import { SettingsSidebar } from './SettingsSidebar';
import { DEFAULT_SECTION, type SectionId } from './types';
import { AccountSection } from './sections/AccountSection';
import { ConnectionsSection } from './sections/ConnectionsSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { NotificationsSection } from './sections/NotificationsSection';
import { AutonomySection } from './sections/AutonomySection';
import { ServersSection } from './sections/ServersSection';
import { AboutSection } from './sections/AboutSection';

export function SettingsOverlay({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<SectionId>(DEFAULT_SECTION);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const resetToken = async () => {
    if (!confirm('Reset bot token? You will need to re-paste it on next launch.')) return;
    await api.bot.clearToken();
    navigate('/onboarding', { replace: true });
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex" onClick={onClose}>
      <div
        className="m-auto w-[90vw] h-[90vh] max-w-[1100px] bg-bg-subtle border border-border rounded-lg flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <SettingsSidebar active={active} onSelect={setActive} onResetToken={resetToken} />
        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-12 shrink-0 px-6 flex items-center justify-end border-b border-border">
            <button
              aria-label="Close settings"
              onClick={onClose}
              className="text-fg-muted hover:text-fg p-1 rounded hover:bg-hover"
            >
              <IconX size={18} stroke={2} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-8 py-6">
            {active === 'account' && <AccountSection />}
            {active === 'connections' && <ConnectionsSection />}
            {active === 'appearance' && <AppearanceSection />}
            {active === 'notifications' && <NotificationsSection />}
            {active === 'autonomy' && <AutonomySection />}
            {active === 'servers' && <ServersSection />}
            {active === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/components/settings/__tests__/SettingsOverlay.test.tsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/SettingsOverlay.tsx src/renderer/components/settings/__tests__/SettingsOverlay.test.tsx
git commit -m "feat(settings): add SettingsOverlay root with Esc close and section routing"
```

---

## Task 11: Wire SettingsOverlay into ShellRoute and delete the old SettingsPanel

**Files:**
- Modify: `src/renderer/routes/shell/ShellRoute.tsx`
- Delete: `src/renderer/components/SettingsPanel.tsx`

- [ ] **Step 1: Update the import and usage in ShellRoute**

Replace this in `src/renderer/routes/shell/ShellRoute.tsx`:

```tsx
import { SettingsPanel } from '../../components/SettingsPanel';
```

with:

```tsx
import { SettingsOverlay } from '../../components/settings/SettingsOverlay';
```

And replace the bottom usage:

```tsx
{settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
```

with:

```tsx
{settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} />}
```

- [ ] **Step 2: Delete the old SettingsPanel**

Run: `rm src/renderer/components/SettingsPanel.tsx`

- [ ] **Step 3: Verify nothing else references SettingsPanel**

Run: `grep -rn "SettingsPanel" src/`
Expected: no output (other than possibly a stale comment, which should also be removed).

- [ ] **Step 4: Verify it compiles and tests still pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean typecheck, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(settings): replace SettingsPanel with SettingsOverlay in shell"
```

---

## Task 12: Remove the right-click "Autonomy settings" entry from ServerRail

**Files:**
- Modify: `src/renderer/components/ServerRail.tsx`

- [ ] **Step 1: Remove the autonomy modal state and right-click entry**

Open `src/renderer/components/ServerRail.tsx` and apply these changes:

1. Remove the import `import { AutonomySettingsTab } from './AutonomySettingsTab';`.
2. Remove the import `IconRobot` from the `@tabler/icons-react` import (keep `IconCheck`).
3. Delete the `autonomyModalForGuild` state and its setter.
4. In `<GuildRailItem />` props, remove the `onOpenAutonomy` prop (and corresponding parameter destructuring).
5. In the `onContextMenu` handler, remove the autonomy entry (the one with `IconRobot` and `label: 'Autonomy settings'`).
6. Delete the modal block at the end of the component (the `{autonomyModalForGuild && (...)}` JSX).

After the edits, the relevant sections look like:

```tsx
// imports
import { IconCheck } from '@tabler/icons-react';
// (no IconRobot, no AutonomySettingsTab import)

// in ServerRail body — no autonomyModalForGuild state at all

// GuildRailItem usage:
<GuildRailItem
  key={g.id}
  guild={g}
  selected={selected === g.id}
  unread={!!unreadGuildIds?.has(g.id)}
  mention={!!mentionGuildIds?.has(g.id)}
  onSelect={onSelect}
  {...(onMarkRead ? { onMarkRead: () => onMarkRead(g.id) } : {})}
  hasUnread={!!unreadGuildIds?.has(g.id) || !!mentionGuildIds?.has(g.id)}
/>

// GuildRailItem signature: drop onOpenAutonomy entirely
function GuildRailItem({
  guild, selected, unread, mention, onSelect, onMarkRead, hasUnread,
}: { guild: GuildSummary; selected: boolean; unread: boolean; mention: boolean; onSelect: (g: GuildSummary) => void; onMarkRead?: () => void; hasUnread: boolean }) {

// onContextMenu: keep only the "Mark as read" entry when applicable
onContextMenu={(e) => {
  const items: Parameters<typeof openContextMenu>[1] = [];
  if (onMarkRead && hasUnread) {
    items.push({
      type: 'item',
      label: 'Mark as read',
      icon: <IconCheck size={14} />,
      onClick: onMarkRead,
    });
  }
  if (items.length === 0) return;
  openContextMenu(e, items);
}}
```

- [ ] **Step 2: Verify nothing else in the codebase relies on the rail's autonomy modal**

Run: `grep -rn "onOpenAutonomy\|autonomyModalForGuild" src/`
Expected: no output.

- [ ] **Step 3: Verify typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean typecheck, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ServerRail.tsx
git commit -m "refactor(rail): remove right-click Autonomy entry (moved to Settings → Servers)"
```

---

## Task 13: Manual smoke test

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Open settings and verify each section**

Click the gear icon. Walk through every sidebar item in order and confirm:
- Account: avatar + username + ID render; "Invite to a new server" works (opens browser).
- Connections: GIPHY field is populated with the saved value if any; typing persists.
- Appearance: shows the "coming soon" card.
- Notifications: close-to-tray toggle works (flip it twice and reload to confirm persistence).
- Autonomy: global autonomy controls render and saving works.
- Servers: list shows all guilds; clicking one drills in; back link returns to list; search filters.
- About: version string matches `package.json`.

Confirm Esc, X button, and clicking the backdrop all close the overlay.

Right-click a server icon: the only entry should be "Mark as read" (when applicable). The "Autonomy settings" entry must be gone.

- [ ] **Step 3: Final typecheck + test pass**

Run: `npm run typecheck && npm test`
Expected: all green.

---

## Self-Review Notes

- **Spec coverage:** Every section listed in the spec table has its own task (2–7). Sidebar layout is Task 9, Overlay/X/Esc is Task 10, Reset Bot Token button is in Task 9 with the handler in Task 10. ServerRail cleanup (Task 12) and SettingsPanel deletion (Task 11) close the loop.
- **Placeholder scan:** No TBD/TODO/"add error handling" placeholders. All code blocks complete.
- **Type consistency:** `SectionId` declared once in Task 1, used by sidebar (Task 9) and overlay (Task 10). `GuildSummary` import path consistent with existing usage.
- **Test mocks:** Each test file mocks `api` independently; no cross-test state.
