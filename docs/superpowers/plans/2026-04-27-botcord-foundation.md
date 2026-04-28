# BotCord Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the BotCord Electron app foundation: project scaffold, locked-down IPC contract, encrypted token vault, bot onboarding wizard, three-pane guild/channel shell, and a stub embed-composer route.

**Architecture:** Electron with a sandboxed renderer (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) and strict CSP. All Discord operations and token handling happen in the main process. The renderer talks to main only through a typed `window.botcord` API exposed via `contextBridge`. Tokens live in `safeStorage`-encrypted files (OS keychain backed). One discord.js client per app instance, single bot only this session.

**Tech Stack:** Electron + electron-vite, React 18 + TypeScript (strict), Tailwind + shadcn/ui, TanStack Query, discord.js v14, better-sqlite3, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-04-27-botcord-foundation-design.md`

---

## Phase 0 — Notes for the engineer

- All paths are relative to repo root unless absolute.
- Use `pnpm` (or swap for `npm`/`yarn` consistently). Examples below assume `pnpm`.
- Do **not** run `electron-builder` or any packaging — out of scope.
- After every task that ends in a commit, the working tree should be clean.
- "Smoke-test" = launch the app with `pnpm dev` and verify the described behavior visually. The first time the app launches, no token exists, so it should land on `/onboarding`.

---

## Task 1: Initialize the project skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `electron.vite.config.ts`
- Create: `src/main/index.ts` (placeholder)
- Create: `src/preload/index.ts` (placeholder)
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx` (placeholder)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "botcord",
  "version": "0.0.1",
  "private": true,
  "description": "Desktop admin cockpit for Discord (BYOB).",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "typecheck": "tsc --noEmit && tsc -p tsconfig.node.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint . --ext .ts,.tsx"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "discord.js": "^14.16.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.27.0",
    "@tanstack/react-query": "^5.59.0"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-vite": "^2.3.0",
    "vite": "^5.4.0",
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/better-sqlite3": "^7.6.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vitest": "^2.1.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "jsdom": "^25.0.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json` (renderer + shared)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "allowJs": false,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"],
      "@renderer/*": ["src/renderer/*"]
    },
    "types": ["vite/client"]
  },
  "include": ["src/renderer", "src/shared", "src/preload"]
}
```

- [ ] **Step 3: Create `tsconfig.node.json` (main process)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"]
    }
  },
  "include": ["src/main", "src/shared"]
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules
out
dist
.vite
*.log
.DS_Store
.env
.env.local
coverage
```

- [ ] **Step 5: Create `.editorconfig`**

```
root = true
[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
```

- [ ] **Step 6: Create `electron.vite.config.ts`**

```ts
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'discord.js'],
      },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
  },
  preload: {
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer'),
      },
    },
  },
});
```

- [ ] **Step 7: Create placeholder `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron';

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1200, height: 800 });
  win.loadURL('about:blank');
});
```

- [ ] **Step 8: Create placeholder `src/preload/index.ts`**

```ts
// Preload runs in an isolated context. Real exposure happens in a later task.
export {};
```

- [ ] **Step 9: Create `src/renderer/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>BotCord</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 10: Create placeholder `src/renderer/main.tsx`**

```tsx
import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(<div>BotCord</div>);
```

- [ ] **Step 11: Install and verify build**

Run: `pnpm install && pnpm build`
Expected: PASS — three bundles produced under `out/{main,preload,renderer}`. No TypeScript errors.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite + TypeScript project"
```

---

## Task 2: Tailwind, shadcn primitives, and base styles

**Files:**
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `components.json`
- Create: `src/renderer/styles/globals.css`
- Create: `src/renderer/lib/cn.ts`
- Modify: `src/renderer/main.tsx`

- [ ] **Step 1: Create `tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#1a1b1f', subtle: '#23252b', sunken: '#141519' },
        fg: { DEFAULT: '#e7e8ea', muted: '#9aa0a6' },
        accent: { DEFAULT: '#7c5cff', hover: '#8e72ff' },
        danger: '#e5484d',
        warn: '#f5a524',
        ok: '#3dd68c',
        border: '#2c2e36',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 2: Create `postcss.config.js`**

```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 3: Create `components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/renderer/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": false,
    "prefix": ""
  },
  "aliases": {
    "components": "@renderer/components",
    "ui": "@renderer/components/ui",
    "lib": "@renderer/lib",
    "utils": "@renderer/lib/cn"
  },
  "rsc": false,
  "tsx": true
}
```

- [ ] **Step 4: Create `src/renderer/styles/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; }
body {
  @apply bg-bg text-fg font-sans antialiased;
  margin: 0;
}
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-thumb { background: #3a3d46; border-radius: 4px; }
```

- [ ] **Step 5: Create `src/renderer/lib/cn.ts`**

```ts
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
```

- [ ] **Step 6: Update `src/renderer/main.tsx` to import styles**

```tsx
import { createRoot } from 'react-dom/client';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <div className="p-6 text-fg">BotCord</div>
);
```

- [ ] **Step 7: Smoke test**

Run: `pnpm dev`
Expected: Window opens with dark background and "BotCord" text in the configured foreground color. Close the app.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: add tailwind + shadcn config and base styles"
```

---

## Task 3: Harden the main window (CSP, sandbox, single instance)

**Files:**
- Modify: `src/main/index.ts`
- Create: `src/main/window.ts`
- Create: `src/main/security/csp.ts`

- [ ] **Step 1: Create `src/main/security/csp.ts`**

```ts
import { session } from 'electron';

const CSP = [
  "default-src 'self'",
  "img-src 'self' https://cdn.discordapp.com data:",
  "connect-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');

export function installCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });
}
```

- [ ] **Step 2: Create `src/main/window.ts`**

```ts
import { BrowserWindow, shell } from 'electron';
import { join } from 'path';

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#1a1b1f',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://discord.com/') || url.startsWith('https://cdn.discordapp.com/')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) e.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}
```

- [ ] **Step 3: Replace `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { installCSP } from './security/csp';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    installCSP();
    createMainWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
```

- [ ] **Step 4: Smoke test**

Run: `pnpm dev`
Expected: Window opens. Open DevTools (View → Toggle DevTools) and check the Console. There should be no CSP violation errors. Try `window.require` in the console — it should be `undefined`. Close the app.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(main): harden window with CSP, sandbox, single-instance lock"
```

---

## Task 4: Shared types — domain DTOs, errors, IPC contract

**Files:**
- Create: `src/shared/domain.ts`
- Create: `src/shared/errors.ts`
- Create: `src/shared/ipc-contract.ts`

- [ ] **Step 1: Create `src/shared/domain.ts`**

```ts
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

export type DraftInput = Omit<DraftRow, 'createdAt' | 'updatedAt'> & { id?: string };

export type Prefs = {
  lastSelectedGuildId: string | null;
  lastSelectedChannelId: string | null;
  theme: 'dark';
};
```

- [ ] **Step 2: Create `src/shared/errors.ts`**

```ts
export type IpcErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_TOKEN'
  | 'MISSING_INTENTS'
  | 'MISSING_PERMISSIONS'
  | 'DISCORD_RATE_LIMITED'
  | 'DISCORD_HTTP_ERROR'
  | 'GATEWAY_OFFLINE'
  | 'NOT_FOUND'
  | 'INTERNAL';

export type IpcError = {
  code: IpcErrorCode;
  message: string;
  retryAfterMs?: number;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: IpcError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const err = (code: IpcErrorCode, message: string, retryAfterMs?: number): Result<never> =>
  ({ ok: false, error: retryAfterMs !== undefined ? { code, message, retryAfterMs } : { code, message } });
```

- [ ] **Step 3: Create `src/shared/ipc-contract.ts`**

```ts
import type {
  BotIdentity, BotStatus, ChannelSummary, DraftInput, DraftRow,
  EmbedPayload, GatewayState, GuildSummary, MessageSummary, Prefs,
} from './domain';
import type { Result } from './errors';

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

export const IPC_CHANNELS = {
  // request/reply
  'bot.getStatus': 'bot.getStatus',
  'bot.validateToken': 'bot.validateToken',
  'bot.saveToken': 'bot.saveToken',
  'bot.clearToken': 'bot.clearToken',
  'bot.buildInviteUrl': 'bot.buildInviteUrl',
  'guilds.list': 'guilds.list',
  'guilds.listChannels': 'guilds.listChannels',
  'messages.send': 'messages.send',
  'messages.sendEmbed': 'messages.sendEmbed',
  'messages.history': 'messages.history',
  'messages.delete': 'messages.delete',
  'messages.bulkDelete': 'messages.bulkDelete',
  'drafts.list': 'drafts.list',
  'drafts.upsert': 'drafts.upsert',
  'drafts.delete': 'drafts.delete',
  'prefs.get': 'prefs.get',
  'prefs.set': 'prefs.set',
  'system.appVersion': 'system.appVersion',
  'system.openExternal': 'system.openExternal',
  // events (main → renderer)
  'event.botStatus': 'event.botStatus',
  'event.gatewayState': 'event.gatewayState',
  'event.guildUpdate': 'event.guildUpdate',
  'event.channelUpdate': 'event.channelUpdate',
} as const;

export type IpcChannel = keyof typeof IPC_CHANNELS;

declare global {
  interface Window {
    botcord: BotcordApi;
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): add domain DTOs, error model, and IPC contract types"
```

---

## Task 5: Preload bridge — exposeInMainWorld

**Files:**
- Modify: `src/preload/index.ts`
- Create: `src/preload/expose.ts`

- [ ] **Step 1: Create `src/preload/expose.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-contract';
import type { BotcordApi } from '../shared/ipc-contract';

const invoke = <T>(channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const subscribe = (channel: string, cb: (payload: unknown) => void): (() => void) => {
  const handler = (_: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const api: BotcordApi = {
  bot: {
    getStatus: () => invoke(IPC_CHANNELS['bot.getStatus']),
    validateToken: (token) => invoke(IPC_CHANNELS['bot.validateToken'], token),
    saveToken: (token) => invoke(IPC_CHANNELS['bot.saveToken'], token),
    clearToken: () => invoke(IPC_CHANNELS['bot.clearToken']),
    buildInviteUrl: (clientId) => invoke(IPC_CHANNELS['bot.buildInviteUrl'], clientId),
  },
  guilds: {
    list: () => invoke(IPC_CHANNELS['guilds.list']),
    listChannels: (guildId) => invoke(IPC_CHANNELS['guilds.listChannels'], guildId),
  },
  messages: {
    send: (channelId, content) => invoke(IPC_CHANNELS['messages.send'], channelId, content),
    sendEmbed: (channelId, embed, content) =>
      invoke(IPC_CHANNELS['messages.sendEmbed'], channelId, embed, content),
    history: (channelId, opts) => invoke(IPC_CHANNELS['messages.history'], channelId, opts),
    delete: (channelId, messageId) => invoke(IPC_CHANNELS['messages.delete'], channelId, messageId),
    bulkDelete: (channelId, ids) => invoke(IPC_CHANNELS['messages.bulkDelete'], channelId, ids),
  },
  drafts: {
    list: () => invoke(IPC_CHANNELS['drafts.list']),
    upsert: (draft) => invoke(IPC_CHANNELS['drafts.upsert'], draft),
    delete: (id) => invoke(IPC_CHANNELS['drafts.delete'], id),
  },
  prefs: {
    get: (key) => invoke(IPC_CHANNELS['prefs.get'], key),
    set: (key, value) => invoke(IPC_CHANNELS['prefs.set'], key, value),
  },
  events: {
    onBotStatus: (cb) => subscribe(IPC_CHANNELS['event.botStatus'], cb as (p: unknown) => void),
    onGatewayState: (cb) => subscribe(IPC_CHANNELS['event.gatewayState'], cb as (p: unknown) => void),
    onGuildUpdate: (cb) => subscribe(IPC_CHANNELS['event.guildUpdate'], cb as (p: unknown) => void),
    onChannelUpdate: (cb) => subscribe(IPC_CHANNELS['event.channelUpdate'], cb as (p: unknown) => void),
  },
  system: {
    appVersion: () => invoke(IPC_CHANNELS['system.appVersion']),
    openExternal: (url) => invoke(IPC_CHANNELS['system.openExternal'], url),
  },
};

contextBridge.exposeInMainWorld('botcord', api);
```

- [ ] **Step 2: Replace `src/preload/index.ts`**

```ts
import './expose';
```

- [ ] **Step 3: Smoke test**

Run: `pnpm dev`. In DevTools console: `typeof window.botcord` and `Object.keys(window.botcord)`.
Expected: `'object'` and `['bot','guilds','messages','drafts','prefs','events','system']`. Calls will reject because no main handlers exist yet — that's fine.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(preload): expose typed botcord API via contextBridge"
```

---

## Task 6: Token vault (TDD)

**Files:**
- Create: `src/main/vault/token-vault.ts`
- Create: `src/main/vault/README.md`
- Create: `src/main/vault/__tests__/token-vault.test.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    environmentMatchGlobs: [['src/renderer/**', 'jsdom']],
    setupFiles: [],
  },
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
  },
});
```

- [ ] **Step 2: Write the failing test (`src/main/vault/__tests__/token-vault.test.ts`)**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createTokenVault } from '../token-vault';

let encryptionAvailable = true;
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  },
}));

let dir: string;
beforeEach(() => {
  encryptionAvailable = true;
  dir = mkdtempSync(join(tmpdir(), 'botcord-vault-'));
});

afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe('TokenVault', () => {
  it('starts empty', () => {
    const v = createTokenVault(dir);
    expect(v.hasToken()).toBe(false);
  });

  it('saves, reads, and clears tokens round-trip', async () => {
    const v = createTokenVault(dir);
    await v.saveToken('my-secret-token');
    expect(v.hasToken()).toBe(true);
    expect(await v.readToken()).toBe('my-secret-token');
    await v.clear();
    expect(v.hasToken()).toBe(false);
    expect(await v.readToken()).toBe(null);
  });

  it('writes ciphertext to disk, never plaintext', async () => {
    const v = createTokenVault(dir);
    await v.saveToken('plaintext-marker');
    const path = join(dir, 'token.bin');
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path).toString('utf8');
    expect(raw.includes('plaintext-marker')).toBe(false);
    expect(raw.startsWith('enc:')).toBe(true);
  });

  it('throws when encryption is unavailable', async () => {
    encryptionAvailable = false;
    const v = createTokenVault(dir);
    await expect(v.saveToken('x')).rejects.toThrow(/encryption.*unavailable/i);
  });

  it('overwrites existing token atomically', async () => {
    const v = createTokenVault(dir);
    await v.saveToken('first');
    await v.saveToken('second');
    expect(await v.readToken()).toBe('second');
  });
});
```

- [ ] **Step 3: Run the failing test**

Run: `pnpm test src/main/vault`
Expected: FAIL — `createTokenVault` not found.

- [ ] **Step 4: Implement `src/main/vault/token-vault.ts`**

```ts
import { safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync, chmodSync } from 'fs';
import { join } from 'path';

export interface TokenVault {
  hasToken(): boolean;
  saveToken(plaintext: string): Promise<void>;
  readToken(): Promise<string | null>;
  clear(): Promise<void>;
}

export function createTokenVault(baseDir: string): TokenVault {
  if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
  const file = join(baseDir, 'token.bin');
  const tmp = join(baseDir, 'token.bin.tmp');

  const ensureAvailable = () => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is unavailable on this system');
    }
  };

  return {
    hasToken: () => existsSync(file),

    async saveToken(plaintext: string) {
      ensureAvailable();
      const cipher = safeStorage.encryptString(plaintext);
      writeFileSync(tmp, cipher);
      try { chmodSync(tmp, 0o600); } catch { /* non-POSIX */ }
      renameSync(tmp, file);
    },

    async readToken() {
      if (!existsSync(file)) return null;
      ensureAvailable();
      const buf = readFileSync(file);
      return safeStorage.decryptString(buf);
    },

    async clear() {
      if (existsSync(file)) unlinkSync(file);
    },
  };
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm test src/main/vault`
Expected: PASS, all 5 cases.

- [ ] **Step 6: Add `src/main/vault/README.md`**

```md
# Token Vault

Stores the bot token encrypted at rest using Electron's `safeStorage` API.

## Threat model

- **At rest:** ciphertext only on disk. `safeStorage` delegates to OS keychain (Keychain / DPAPI / libsecret).
- **In memory:** plaintext exists only inside the discord.js client and during the brief `readToken()` → `Client.login()` call. Never logged.
- **Cross-process:** plaintext never crosses the contextBridge. The renderer cannot read the token.
- **File mode:** `0600` on POSIX. No effect on Windows; OS-level ACLs apply.

## Failure modes

- `safeStorage.isEncryptionAvailable()` false → throws. We refuse to silently store plaintext or weakly-encrypted data.
- `token.bin.tmp` left behind from a crashed save → next save overwrites it via atomic rename.

## Audit checklist

- Vault is the only module that imports `safeStorage`.
- Vault is consumed only by `discord/client-manager.ts`.
- No `console.log` or telemetry references the plaintext.
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(vault): encrypted token storage via safeStorage with tests"
```

---

## Task 7: Permissions and invite URL (TDD)

**Files:**
- Create: `src/main/discord/intents.ts`
- Create: `src/main/discord/permissions.ts`
- Create: `src/main/discord/__tests__/permissions.test.ts`

- [ ] **Step 1: Create `src/main/discord/intents.ts`**

```ts
import { GatewayIntentBits } from 'discord.js';

export const REQUIRED_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMembers,
];
```

- [ ] **Step 2: Write the failing test**

```ts
// src/main/discord/__tests__/permissions.test.ts
import { describe, it, expect } from 'vitest';
import { BOT_PERMISSIONS_BITFIELD, buildInviteUrl } from '../permissions';

describe('permissions', () => {
  it('exposes a non-zero bitfield string', () => {
    expect(typeof BOT_PERMISSIONS_BITFIELD).toBe('string');
    expect(BigInt(BOT_PERMISSIONS_BITFIELD)).toBeGreaterThan(0n);
  });

  it('builds a valid invite URL containing client_id, perms, and bot scope', () => {
    const url = buildInviteUrl('123456789012345678');
    expect(url).toMatch(/^https:\/\/discord\.com\/api\/oauth2\/authorize\?/);
    const params = new URL(url).searchParams;
    expect(params.get('client_id')).toBe('123456789012345678');
    expect(params.get('permissions')).toBe(BOT_PERMISSIONS_BITFIELD);
    expect(params.get('scope')).toBe('bot applications.commands');
  });

  it('rejects malformed client IDs', () => {
    expect(() => buildInviteUrl('')).toThrow();
    expect(() => buildInviteUrl('abc')).toThrow();
    expect(() => buildInviteUrl('12345')).toThrow();      // too short
    expect(() => buildInviteUrl('1234567890123456789012345')).toThrow(); // too long
  });
});
```

- [ ] **Step 3: Run the failing test**

Run: `pnpm test src/main/discord`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/main/discord/permissions.ts`**

```ts
import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';

const REQUIRED_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageThreads,
];

export const BOT_PERMISSIONS_BITFIELD = new PermissionsBitField(REQUIRED_PERMISSIONS).bitfield.toString();

const SNOWFLAKE_RE = /^\d{17,20}$/;

export function buildInviteUrl(clientId: string): string {
  if (!SNOWFLAKE_RE.test(clientId)) {
    throw new Error('Invalid Discord client ID (expected a 17-20 digit snowflake)');
  }
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('permissions', BOT_PERMISSIONS_BITFIELD);
  url.searchParams.set('scope', 'bot applications.commands');
  return url.toString();
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm test src/main/discord`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(discord): bot permissions bitfield and invite URL builder"
```

---

## Task 8: Discord client manager

**Files:**
- Create: `src/main/discord/client-manager.ts`
- Create: `src/main/events/gateway-events.ts`

- [ ] **Step 1: Create `src/main/events/gateway-events.ts`**

```ts
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';

export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

export const GATEWAY_EVENT_CHANNEL = IPC_CHANNELS['event.gatewayState'];
export const BOT_STATUS_CHANNEL = IPC_CHANNELS['event.botStatus'];
export const GUILD_UPDATE_CHANNEL = IPC_CHANNELS['event.guildUpdate'];
export const CHANNEL_UPDATE_CHANNEL = IPC_CHANNELS['event.channelUpdate'];
```

- [ ] **Step 2: Create `src/main/discord/client-manager.ts`**

```ts
import { Client, Events } from 'discord.js';
import type { BotIdentity, BotStatus, GatewayState, GuildSummary, ChannelSummary, ChannelKind } from '../../shared/domain';
import { REQUIRED_INTENTS } from './intents';
import {
  broadcast,
  BOT_STATUS_CHANNEL,
  GATEWAY_EVENT_CHANNEL,
  GUILD_UPDATE_CHANNEL,
  CHANNEL_UPDATE_CHANNEL,
} from '../events/gateway-events';
import type { TokenVault } from '../vault/token-vault';

export type ClientManager = {
  getStatus(): BotStatus;
  getClient(): Client | null;
  connect(): Promise<{ ok: true; identity: BotIdentity } | { ok: false; reason: 'INVALID_TOKEN' | 'MISSING_INTENTS' | 'INTERNAL'; message: string }>;
  disconnect(): Promise<void>;
};

export function createClientManager(vault: TokenVault): ClientManager {
  let client: Client | null = null;
  let identity: BotIdentity | null = null;
  let gateway: GatewayState = { status: 'disconnected', reason: null };
  let reconnectAttempt = 0;

  const setGateway = (next: GatewayState) => {
    gateway = next;
    broadcast(GATEWAY_EVENT_CHANNEL, gateway);
    broadcast(BOT_STATUS_CHANNEL, getStatus());
  };

  const getStatus = (): BotStatus =>
    identity ? { kind: 'configured', identity, gateway } : { kind: 'unconfigured' };

  const toIdentity = (c: Client): BotIdentity => {
    const u = c.user!;
    return {
      id: u.id,
      username: u.username,
      discriminator: u.discriminator,
      avatarUrl: u.displayAvatarURL({ size: 128 }),
    };
  };

  const toGuildSummary = (g: { id: string; name: string; iconURL: (o?: { size: number }) => string | null; memberCount: number | null }): GuildSummary => ({
    id: g.id,
    name: g.name,
    iconUrl: g.iconURL({ size: 128 }) ?? null,
    memberCount: g.memberCount,
  });

  const wireEvents = (c: Client) => {
    c.on(Events.ClientReady, () => {
      identity = toIdentity(c);
      reconnectAttempt = 0;
      setGateway({ status: 'ready', sessionStartedAt: Date.now() });
    });
    c.on(Events.ShardDisconnect, (_, shardId) => {
      setGateway({ status: 'disconnected', reason: `shard ${shardId} disconnected` });
    });
    c.on(Events.ShardReconnecting, () => {
      reconnectAttempt += 1;
      setGateway({ status: 'reconnecting', attempt: reconnectAttempt, lastError: null });
    });
    c.on(Events.ShardError, (e) => {
      setGateway({ status: 'reconnecting', attempt: reconnectAttempt, lastError: e.message });
    });
    c.on(Events.GuildCreate, (g) => broadcast(GUILD_UPDATE_CHANNEL, toGuildSummary(g)));
    c.on(Events.GuildUpdate, (_, g) => broadcast(GUILD_UPDATE_CHANNEL, toGuildSummary(g)));
    c.on(Events.ChannelCreate, (ch) => broadcast(CHANNEL_UPDATE_CHANNEL, projectChannel(ch)));
    c.on(Events.ChannelUpdate, (_, ch) => broadcast(CHANNEL_UPDATE_CHANNEL, projectChannel(ch)));
  };

  return {
    getStatus,
    getClient: () => client,

    async connect() {
      const token = await vault.readToken();
      if (!token) return { ok: false, reason: 'INVALID_TOKEN', message: 'No token in vault' };

      client = new Client({ intents: REQUIRED_INTENTS });
      wireEvents(client);
      setGateway({ status: 'connecting' });

      try {
        await client.login(token);
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('gateway timeout')), 30_000);
          client!.once(Events.ClientReady, () => { clearTimeout(timeout); resolve(); });
          client!.once(Events.Error, (e) => { clearTimeout(timeout); reject(e); });
        });
        return { ok: true, identity: identity! };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        await this.disconnect();
        if (/disallowed intents/i.test(message)) {
          return { ok: false, reason: 'MISSING_INTENTS', message };
        }
        if (/token/i.test(message) && /invalid/i.test(message)) {
          return { ok: false, reason: 'INVALID_TOKEN', message };
        }
        return { ok: false, reason: 'INTERNAL', message };
      }
    },

    async disconnect() {
      if (client) {
        try { client.removeAllListeners(); client.destroy(); } catch { /* ignore */ }
      }
      client = null;
      identity = null;
      reconnectAttempt = 0;
      setGateway({ status: 'disconnected', reason: null });
    },
  };
}

export function projectChannel(ch: { id: string; guildId: string | null; name: string | null; type: number; parentId: string | null; position?: number; topic?: string | null }): ChannelSummary {
  return {
    id: ch.id,
    guildId: ch.guildId ?? '',
    name: ch.name ?? '(unnamed)',
    type: mapType(ch.type),
    parentId: ch.parentId ?? null,
    position: ch.position ?? 0,
    topic: ch.topic ?? null,
  };
}

function mapType(t: number): ChannelKind {
  // discord.js ChannelType: 0=GuildText, 2=GuildVoice, 4=GuildCategory, 5=GuildAnnouncement, 11=PublicThread, 12=PrivateThread, 15=GuildForum
  switch (t) {
    case 0: return 'text';
    case 2: return 'voice';
    case 4: return 'category';
    case 5: return 'announcement';
    case 11:
    case 12: return 'thread';
    case 15: return 'forum';
    default: return 'other';
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(discord): client manager with gateway lifecycle and event broadcasting"
```

---

## Task 9: SQLite database + migrations (TDD)

**Files:**
- Create: `src/main/db/migrations/001_init.sql`
- Create: `src/main/db/database.ts`
- Create: `src/main/db/__tests__/database.test.ts`

- [ ] **Step 1: Create `src/main/db/migrations/001_init.sql`**

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
  status TEXT NOT NULL,
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

- [ ] **Step 2: Write the failing test**

```ts
// src/main/db/__tests__/database.test.ts
import { describe, it, expect } from 'vitest';
import { openDatabase } from '../database';

describe('openDatabase', () => {
  it('applies all migrations on a fresh in-memory db', () => {
    const db = openDatabase(':memory:');
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);
    expect(names).toContain('drafts');
    expect(names).toContain('scheduled_posts');
    expect(names).toContain('prefs');
    expect(names).toContain('schema_version');
    const v = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number };
    expect(v.v).toBe(1);
  });

  it('is idempotent — second open is a no-op', async () => {
    const db = openDatabase(':memory:');
    const before = db.prepare('SELECT COUNT(*) as c FROM schema_version').get() as { c: number };
    const { applyMigrations } = await import('../database');
    applyMigrations(db);
    const after = db.prepare('SELECT COUNT(*) as c FROM schema_version').get() as { c: number };
    expect(after.c).toBe(before.c);
  });
});
```

- [ ] **Step 3: Run the failing test**

Run: `pnpm test src/main/db`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/main/db/database.ts`**

```ts
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

export function openDatabase(path: string): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

export function applyMigrations(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>)
      .map(r => r.version)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const m = /^(\d+)_/.exec(file);
    if (!m) continue;
    const version = Number(m[1]);
    if (applied.has(version)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)')
        .run(version, Date.now());
    });
    tx();
  }
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm test src/main/db`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): better-sqlite3 with idempotent migration runner"
```

---

## Task 10: SQLite repos — drafts, scheduled, prefs

**Files:**
- Create: `src/main/db/repos/drafts.ts`
- Create: `src/main/db/repos/scheduled.ts`
- Create: `src/main/db/repos/prefs.ts`
- Create: `src/main/db/repos/__tests__/drafts.test.ts`
- Create: `src/main/db/repos/__tests__/prefs.test.ts`

- [ ] **Step 1: Write failing test for drafts repo**

```ts
// src/main/db/repos/__tests__/drafts.test.ts
import { describe, it, expect } from 'vitest';
import { openDatabase } from '../../database';
import { createDraftsRepo } from '../drafts';

describe('drafts repo', () => {
  it('upserts and lists drafts', () => {
    const db = openDatabase(':memory:');
    const repo = createDraftsRepo(db);
    const a = repo.upsert({ name: 'A', guildId: null, channelId: null, content: 'hi', embed: null });
    expect(a.id).toBeTruthy();
    expect(a.createdAt).toBe(a.updatedAt);
    const list = repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('A');
  });

  it('updates an existing draft preserving createdAt', async () => {
    const db = openDatabase(':memory:');
    const repo = createDraftsRepo(db);
    const a = repo.upsert({ name: 'A', guildId: null, channelId: null, content: 'hi', embed: null });
    await new Promise(r => setTimeout(r, 5));
    const b = repo.upsert({ id: a.id, name: 'A2', guildId: null, channelId: null, content: 'bye', embed: null });
    expect(b.id).toBe(a.id);
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.updatedAt).toBeGreaterThan(a.updatedAt);
    expect(b.name).toBe('A2');
  });

  it('deletes by id', () => {
    const db = openDatabase(':memory:');
    const repo = createDraftsRepo(db);
    const a = repo.upsert({ name: 'A', guildId: null, channelId: null, content: null, embed: null });
    repo.delete(a.id);
    expect(repo.list()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `pnpm test src/main/db/repos`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/db/repos/drafts.ts`**

```ts
import type { Database as DB } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { DraftInput, DraftRow, EmbedPayload } from '../../../shared/domain';

type Row = {
  id: string;
  name: string;
  guild_id: string | null;
  channel_id: string | null;
  content: string | null;
  embed_json: string | null;
  created_at: number;
  updated_at: number;
};

const toDomain = (r: Row): DraftRow => ({
  id: r.id,
  name: r.name,
  guildId: r.guild_id,
  channelId: r.channel_id,
  content: r.content,
  embed: r.embed_json ? (JSON.parse(r.embed_json) as EmbedPayload) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface DraftsRepo {
  list(): DraftRow[];
  upsert(input: DraftInput): DraftRow;
  delete(id: string): void;
}

export function createDraftsRepo(db: DB): DraftsRepo {
  const insertStmt = db.prepare(`
    INSERT INTO drafts (id, name, guild_id, channel_id, content, embed_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE drafts SET name=?, guild_id=?, channel_id=?, content=?, embed_json=?, updated_at=?
    WHERE id=?
  `);
  const getStmt = db.prepare('SELECT * FROM drafts WHERE id=?');
  const listStmt = db.prepare('SELECT * FROM drafts ORDER BY updated_at DESC');
  const deleteStmt = db.prepare('DELETE FROM drafts WHERE id=?');

  return {
    list: () => (listStmt.all() as Row[]).map(toDomain),

    upsert(input) {
      const now = Date.now();
      const embedJson = input.embed ? JSON.stringify(input.embed) : null;
      if (input.id) {
        const existing = getStmt.get(input.id) as Row | undefined;
        if (existing) {
          updateStmt.run(input.name, input.guildId, input.channelId, input.content, embedJson, now, input.id);
          return toDomain({ ...existing, name: input.name, guild_id: input.guildId, channel_id: input.channelId, content: input.content, embed_json: embedJson, updated_at: now });
        }
      }
      const id = input.id ?? randomUUID();
      insertStmt.run(id, input.name, input.guildId, input.channelId, input.content, embedJson, now, now);
      return toDomain(getStmt.get(id) as Row);
    },

    delete: (id) => { deleteStmt.run(id); },
  };
}
```

- [ ] **Step 4: Run test**

Run: `pnpm test src/main/db/repos/__tests__/drafts.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `src/main/db/repos/scheduled.ts` (no test this session — only used by stub)**

```ts
import type { Database as DB } from 'better-sqlite3';

export type ScheduledPostStatus = 'pending' | 'sent' | 'failed' | 'canceled';

export interface ScheduledRepo {
  countByStatus(status: ScheduledPostStatus): number;
}

export function createScheduledRepo(db: DB): ScheduledRepo {
  const stmt = db.prepare('SELECT COUNT(*) as c FROM scheduled_posts WHERE status = ?');
  return {
    countByStatus: (status) => (stmt.get(status) as { c: number }).c,
  };
}
```

- [ ] **Step 6: Write failing test for prefs repo**

```ts
// src/main/db/repos/__tests__/prefs.test.ts
import { describe, it, expect } from 'vitest';
import { openDatabase } from '../../database';
import { createPrefsRepo } from '../prefs';

describe('prefs repo', () => {
  it('returns null for unset keys', () => {
    const db = openDatabase(':memory:');
    const repo = createPrefsRepo(db);
    expect(repo.get('lastSelectedGuildId')).toBe(null);
  });

  it('round-trips a string value', () => {
    const db = openDatabase(':memory:');
    const repo = createPrefsRepo(db);
    repo.set('lastSelectedGuildId', '12345');
    expect(repo.get('lastSelectedGuildId')).toBe('12345');
  });

  it('overwrites existing values', () => {
    const db = openDatabase(':memory:');
    const repo = createPrefsRepo(db);
    repo.set('lastSelectedGuildId', 'a');
    repo.set('lastSelectedGuildId', 'b');
    expect(repo.get('lastSelectedGuildId')).toBe('b');
  });
});
```

- [ ] **Step 7: Run failing test**

Run: `pnpm test src/main/db/repos/__tests__/prefs.test.ts`
Expected: FAIL.

- [ ] **Step 8: Implement `src/main/db/repos/prefs.ts`**

```ts
import type { Database as DB } from 'better-sqlite3';
import type { Prefs } from '../../../shared/domain';

export interface PrefsRepo {
  get<K extends keyof Prefs>(key: K): Prefs[K] | null;
  set<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
}

export function createPrefsRepo(db: DB): PrefsRepo {
  const getStmt = db.prepare('SELECT value_json FROM prefs WHERE key=?');
  const upsertStmt = db.prepare(`
    INSERT INTO prefs (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
  `);
  return {
    get<K extends keyof Prefs>(key: K) {
      const row = getStmt.get(key) as { value_json: string } | undefined;
      return row ? (JSON.parse(row.value_json) as Prefs[K]) : null;
    },
    set<K extends keyof Prefs>(key: K, value: Prefs[K]) {
      upsertStmt.run(key, JSON.stringify(value), Date.now());
    },
  };
}
```

- [ ] **Step 9: Run tests**

Run: `pnpm test src/main/db`
Expected: PASS, all suites.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(db): drafts, scheduled, and prefs repositories with tests"
```

---

## Task 11: IPC handlers — bot namespace

**Files:**
- Create: `src/main/ipc/bot.ts`
- Create: `src/main/ipc/index.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Create `src/main/ipc/bot.ts`**

```ts
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { BotIdentity, BotStatus } from '../../shared/domain';
import type { TokenVault } from '../vault/token-vault';
import { buildInviteUrl } from '../discord/permissions';

type Deps = {
  vault: TokenVault;
  manager: {
    getStatus(): BotStatus;
    connect(): Promise<{ ok: true; identity: BotIdentity } | { ok: false; reason: string; message: string }>;
    disconnect(): Promise<void>;
  };
};

export function registerBotHandlers({ vault, manager }: Deps): void {
  ipcMain.handle(IPC_CHANNELS['bot.getStatus'], (): BotStatus => manager.getStatus());

  ipcMain.handle(IPC_CHANNELS['bot.validateToken'], async (_, token: unknown): Promise<Result<BotIdentity>> => {
    if (typeof token !== 'string' || !token.trim()) return err('INVALID_TOKEN', 'Token must be a non-empty string');
    try {
      const res = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${token.trim()}` },
      });
      if (res.status === 401) return err('INVALID_TOKEN', 'Discord rejected the token');
      if (!res.ok) return err('DISCORD_HTTP_ERROR', `HTTP ${res.status}`);
      const data = await res.json() as { id: string; username: string; discriminator: string; avatar: string | null };
      return ok({
        id: data.id,
        username: data.username,
        discriminator: data.discriminator,
        avatarUrl: data.avatar
          ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=128`
          : null,
      });
    } catch (e) {
      return err('INTERNAL', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['bot.saveToken'], async (_, token: unknown): Promise<Result<BotIdentity>> => {
    if (typeof token !== 'string' || !token.trim()) return err('INVALID_TOKEN', 'Token must be a non-empty string');
    // Validate first so we don't persist a bad token.
    const validateRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token.trim()}` },
    });
    if (validateRes.status === 401) return err('INVALID_TOKEN', 'Discord rejected the token');
    if (!validateRes.ok) return err('DISCORD_HTTP_ERROR', `HTTP ${validateRes.status}`);

    await vault.saveToken(token.trim());
    const result = await manager.connect();
    if (!result.ok) {
      if (result.reason === 'MISSING_INTENTS') return err('MISSING_INTENTS', result.message);
      if (result.reason === 'INVALID_TOKEN') return err('INVALID_TOKEN', result.message);
      return err('INTERNAL', result.message);
    }
    return ok(result.identity);
  });

  ipcMain.handle(IPC_CHANNELS['bot.clearToken'], async (): Promise<Result<void>> => {
    await manager.disconnect();
    await vault.clear();
    return ok(undefined);
  });

  ipcMain.handle(IPC_CHANNELS['bot.buildInviteUrl'], async (_, clientId: unknown): Promise<Result<string>> => {
    if (typeof clientId !== 'string') return err('INTERNAL', 'clientId must be a string');
    try {
      return ok(buildInviteUrl(clientId));
    } catch (e) {
      return err('INTERNAL', e instanceof Error ? e.message : String(e));
    }
  });
}
```

- [ ] **Step 2: Create `src/main/ipc/index.ts` (registers all namespaces — others added in later tasks)**

```ts
import type { TokenVault } from '../vault/token-vault';
import type { Database as DB } from 'better-sqlite3';
import { registerBotHandlers } from './bot';
import { registerGuildHandlers } from './guilds';
import { registerMessageHandlers } from './messages';
import { registerSystemHandlers } from './system';
import { registerDraftsHandlers } from './drafts';
import { registerPrefsHandlers } from './prefs';
import type { ClientManager } from '../discord/client-manager';

export type IpcDeps = {
  vault: TokenVault;
  manager: ClientManager;
  db: DB;
};

export function registerAllIpc(deps: IpcDeps): void {
  registerBotHandlers(deps);
  registerGuildHandlers(deps);
  registerMessageHandlers(deps);
  registerSystemHandlers();
  registerDraftsHandlers(deps);
  registerPrefsHandlers(deps);
}
```

- [ ] **Step 3: Add stub files so `index.ts` compiles** — these are filled in by later tasks.

Create `src/main/ipc/guilds.ts`:

```ts
import type { IpcDeps } from './index';
export function registerGuildHandlers(_: IpcDeps): void { /* Task 12 */ }
```

Create `src/main/ipc/messages.ts`:

```ts
import type { IpcDeps } from './index';
export function registerMessageHandlers(_: IpcDeps): void { /* Task 13 */ }
```

Create `src/main/ipc/system.ts`:

```ts
export function registerSystemHandlers(): void { /* Task 14 */ }
```

Create `src/main/ipc/drafts.ts`:

```ts
import type { IpcDeps } from './index';
export function registerDraftsHandlers(_: IpcDeps): void { /* Task 14 */ }
```

Create `src/main/ipc/prefs.ts`:

```ts
import type { IpcDeps } from './index';
export function registerPrefsHandlers(_: IpcDeps): void { /* Task 14 */ }
```

- [ ] **Step 4: Wire everything in `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { createMainWindow } from './window';
import { installCSP } from './security/csp';
import { createTokenVault } from './vault/token-vault';
import { createClientManager } from './discord/client-manager';
import { openDatabase } from './db/database';
import { registerAllIpc } from './ipc';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    installCSP();

    const userData = app.getPath('userData');
    const vault = createTokenVault(join(userData, 'vault'));
    const manager = createClientManager(vault);
    const db = openDatabase(join(userData, 'botcord.sqlite'));

    registerAllIpc({ vault, manager, db });

    createMainWindow();

    if (vault.hasToken()) {
      manager.connect().catch(() => { /* surfaced via gateway state events */ });
    }
  });

  app.on('window-all-closed', () => app.quit());
}
```

- [ ] **Step 5: Smoke test**

Run: `pnpm dev`. In DevTools console:

```js
await window.botcord.bot.getStatus();
await window.botcord.bot.buildInviteUrl('123456789012345678');
```

Expected: First returns `{ kind: 'unconfigured' }`. Second returns `{ ok: true, data: 'https://discord.com/api/oauth2/authorize?...' }`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ipc): bot namespace handlers and registration scaffolding"
```

---

## Task 12: IPC handlers — guilds namespace

**Files:**
- Modify: `src/main/ipc/guilds.ts`

- [ ] **Step 1: Replace `src/main/ipc/guilds.ts`**

```ts
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { GuildSummary, ChannelSummary } from '../../shared/domain';
import { projectChannel } from '../discord/client-manager';
import type { IpcDeps } from './index';

export function registerGuildHandlers({ manager }: IpcDeps): void {
  ipcMain.handle(IPC_CHANNELS['guilds.list'], async (): Promise<Result<GuildSummary[]>> => {
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guilds = client.guilds.cache.map(g => ({
      id: g.id,
      name: g.name,
      iconUrl: g.iconURL({ size: 128 }) ?? null,
      memberCount: g.memberCount ?? null,
    }));
    return ok(guilds);
  });

  ipcMain.handle(IPC_CHANNELS['guilds.listChannels'], async (_, guildId: unknown): Promise<Result<ChannelSummary[]>> => {
    if (typeof guildId !== 'string') return err('INTERNAL', 'guildId must be a string');
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return err('NOT_FOUND', `Guild ${guildId} not found`);
    const channels = guild.channels.cache.map(c => projectChannel({
      id: c.id,
      guildId: guild.id,
      name: c.name,
      type: c.type,
      parentId: 'parentId' in c ? (c.parentId ?? null) : null,
      position: 'position' in c ? c.position : 0,
      topic: 'topic' in c ? (c.topic ?? null) : null,
    }));
    return ok(channels);
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(ipc): guilds.list and guilds.listChannels handlers"
```

---

## Task 13: IPC handlers — messages namespace

**Files:**
- Modify: `src/main/ipc/messages.ts`

- [ ] **Step 1: Replace `src/main/ipc/messages.ts`**

```ts
import { ipcMain } from 'electron';
import { EmbedBuilder, type Message, type TextBasedChannel } from 'discord.js';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { EmbedPayload, MessageSummary } from '../../shared/domain';
import type { IpcDeps } from './index';

const summarize = (m: Message): MessageSummary => ({
  id: m.id,
  channelId: m.channelId,
  authorId: m.author.id,
  authorTag: `${m.author.username}#${m.author.discriminator}`,
  content: m.content,
  createdAt: m.createdTimestamp,
  editedAt: m.editedTimestamp,
  hasEmbeds: m.embeds.length > 0,
  hasAttachments: m.attachments.size > 0,
});

const buildEmbed = (p: EmbedPayload): EmbedBuilder => {
  const e = new EmbedBuilder();
  if (p.title) e.setTitle(p.title);
  if (p.description) e.setDescription(p.description);
  if (p.url) e.setURL(p.url);
  if (typeof p.color === 'number') e.setColor(p.color);
  if (p.timestamp) e.setTimestamp(new Date(p.timestamp));
  if (p.footer) e.setFooter({ text: p.footer.text, iconURL: p.footer.iconUrl });
  if (p.author) e.setAuthor({ name: p.author.name, url: p.author.url, iconURL: p.author.iconUrl });
  if (p.thumbnail) e.setThumbnail(p.thumbnail.url);
  if (p.image) e.setImage(p.image.url);
  if (p.fields?.length) e.addFields(p.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline ?? false })));
  return e;
};

export function registerMessageHandlers({ manager }: IpcDeps): void {
  const requireSendableChannel = async (channelId: string): Promise<{ ok: true; channel: TextBasedChannel } | Result<never>> => {
    const client = manager.getClient();
    if (!client || !client.isReady()) return err('GATEWAY_OFFLINE', 'Bot is not connected');
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || !('send' in ch) || typeof (ch as TextBasedChannel).send !== 'function') {
      return err('NOT_FOUND', `Channel ${channelId} is not a sendable text channel`);
    }
    return { ok: true, channel: ch as TextBasedChannel };
  };

  ipcMain.handle(IPC_CHANNELS['messages.send'], async (_, channelId: unknown, content: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof content !== 'string') return err('INTERNAL', 'invalid arguments');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    try {
      const msg = await (got as { ok: true; channel: TextBasedChannel }).channel.send({ content });
      return ok(summarize(msg));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.sendEmbed'], async (_, channelId: unknown, embed: unknown, content?: unknown): Promise<Result<MessageSummary>> => {
    if (typeof channelId !== 'string' || typeof embed !== 'object' || embed === null) return err('INTERNAL', 'invalid arguments');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary>;
    try {
      const msg = await (got as { ok: true; channel: TextBasedChannel }).channel.send({
        content: typeof content === 'string' ? content : undefined,
        embeds: [buildEmbed(embed as EmbedPayload)],
      });
      return ok(summarize(msg));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.history'], async (_, channelId: unknown, opts: unknown): Promise<Result<MessageSummary[]>> => {
    if (typeof channelId !== 'string' || typeof opts !== 'object' || opts === null) return err('INTERNAL', 'invalid arguments');
    const o = opts as { before?: string; limit: number };
    if (typeof o.limit !== 'number' || o.limit < 1 || o.limit > 100) return err('INTERNAL', 'limit must be 1-100');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<MessageSummary[]>;
    try {
      const fetchOpts: { limit: number; before?: string } = { limit: o.limit };
      if (o.before) fetchOpts.before = o.before;
      const messages = await (got as { ok: true; channel: TextBasedChannel }).channel.messages.fetch(fetchOpts);
      return ok(Array.from(messages.values()).map(summarize));
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.delete'], async (_, channelId: unknown, messageId: unknown): Promise<Result<void>> => {
    if (typeof channelId !== 'string' || typeof messageId !== 'string') return err('INTERNAL', 'invalid arguments');
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<void>;
    try {
      const msg = await (got as { ok: true; channel: TextBasedChannel }).channel.messages.fetch(messageId);
      await msg.delete();
      return ok(undefined);
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['messages.bulkDelete'], async (_, channelId: unknown, messageIds: unknown): Promise<Result<{ deleted: string[] }>> => {
    if (typeof channelId !== 'string' || !Array.isArray(messageIds)) return err('INTERNAL', 'invalid arguments');
    const ids = messageIds.filter((v): v is string => typeof v === 'string');
    if (ids.length === 0) return ok({ deleted: [] });
    const got = await requireSendableChannel(channelId);
    if ('ok' in got && got.ok === false) return got as Result<{ deleted: string[] }>;
    const channel = (got as { ok: true; channel: TextBasedChannel }).channel;
    if (!('bulkDelete' in channel) || typeof (channel as { bulkDelete: unknown }).bulkDelete !== 'function') {
      return err('MISSING_PERMISSIONS', 'Channel does not support bulk delete');
    }
    try {
      const result = await (channel as unknown as { bulkDelete: (ids: string[], filterOld?: boolean) => Promise<Map<string, Message>> })
        .bulkDelete(ids, true);
      return ok({ deleted: Array.from(result.keys()) });
    } catch (e) {
      return err('DISCORD_HTTP_ERROR', e instanceof Error ? e.message : String(e));
    }
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(ipc): messages namespace — send/sendEmbed/history/delete/bulkDelete"
```

---

## Task 14: IPC handlers — system, drafts, prefs

**Files:**
- Modify: `src/main/ipc/system.ts`
- Modify: `src/main/ipc/drafts.ts`
- Modify: `src/main/ipc/prefs.ts`

- [ ] **Step 1: Replace `src/main/ipc/system.ts`**

```ts
import { ipcMain, app, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';

const ALLOWED_PREFIXES = [
  'https://discord.com/',
  'https://cdn.discordapp.com/',
  'https://discordapp.com/',
];

export function registerSystemHandlers(): void {
  ipcMain.handle(IPC_CHANNELS['system.appVersion'], () => app.getVersion());
  ipcMain.handle(IPC_CHANNELS['system.openExternal'], async (_, url: unknown) => {
    if (typeof url !== 'string') return;
    if (!ALLOWED_PREFIXES.some(p => url.startsWith(p))) return;
    await shell.openExternal(url);
  });
}
```

- [ ] **Step 2: Replace `src/main/ipc/drafts.ts`**

```ts
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { DraftRow, DraftInput } from '../../shared/domain';
import { createDraftsRepo } from '../db/repos/drafts';
import type { IpcDeps } from './index';

export function registerDraftsHandlers({ db }: IpcDeps): void {
  const repo = createDraftsRepo(db);

  ipcMain.handle(IPC_CHANNELS['drafts.list'], async (): Promise<Result<DraftRow[]>> => ok(repo.list()));

  ipcMain.handle(IPC_CHANNELS['drafts.upsert'], async (_, input: unknown): Promise<Result<DraftRow>> => {
    if (typeof input !== 'object' || input === null) return err('INTERNAL', 'draft input must be an object');
    try {
      return ok(repo.upsert(input as DraftInput));
    } catch (e) {
      return err('INTERNAL', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['drafts.delete'], async (_, id: unknown): Promise<Result<void>> => {
    if (typeof id !== 'string') return err('INTERNAL', 'id must be a string');
    repo.delete(id);
    return ok(undefined);
  });
}
```

- [ ] **Step 3: Replace `src/main/ipc/prefs.ts`**

```ts
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { Prefs } from '../../shared/domain';
import { createPrefsRepo } from '../db/repos/prefs';
import type { IpcDeps } from './index';

const VALID_KEYS: ReadonlyArray<keyof Prefs> = ['lastSelectedGuildId', 'lastSelectedChannelId', 'theme'];

export function registerPrefsHandlers({ db }: IpcDeps): void {
  const repo = createPrefsRepo(db);

  ipcMain.handle(IPC_CHANNELS['prefs.get'], async (_, key: unknown): Promise<Result<unknown>> => {
    if (typeof key !== 'string' || !VALID_KEYS.includes(key as keyof Prefs)) {
      return err('INTERNAL', 'invalid prefs key');
    }
    return ok(repo.get(key as keyof Prefs));
  });

  ipcMain.handle(IPC_CHANNELS['prefs.set'], async (_, key: unknown, value: unknown): Promise<Result<void>> => {
    if (typeof key !== 'string' || !VALID_KEYS.includes(key as keyof Prefs)) {
      return err('INTERNAL', 'invalid prefs key');
    }
    repo.set(key as keyof Prefs, value as Prefs[keyof Prefs]);
    return ok(undefined);
  });
}
```

- [ ] **Step 4: Smoke test**

Run: `pnpm dev`. In DevTools console:

```js
await window.botcord.system.appVersion();
await window.botcord.drafts.list();
await window.botcord.prefs.get('theme');
```

Expected: version string; `{ ok: true, data: [] }`; `{ ok: true, data: null }`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ipc): system, drafts, and prefs handlers"
```

---

## Task 15: Renderer shell — router, query client, api wrapper

**Files:**
- Create: `src/renderer/lib/api.ts`
- Create: `src/renderer/lib/query-client.ts`
- Create: `src/renderer/App.tsx`
- Modify: `src/renderer/main.tsx`

- [ ] **Step 1: Create `src/renderer/lib/api.ts`**

```ts
import type { BotcordApi } from '../../shared/ipc-contract';

export const api: BotcordApi = window.botcord;
```

- [ ] **Step 2: Create `src/renderer/lib/query-client.ts`**

```ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});
```

- [ ] **Step 3: Create `src/renderer/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import { api } from './lib/api';
import type { BotStatus } from '../shared/domain';
import { OnboardingRoute } from './routes/onboarding/OnboardingRoute';
import { ShellRoute } from './routes/shell/ShellRoute';
import { ComposeRoute } from './routes/compose/ComposeRoute';

function StatusGate() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    api.bot.getStatus().then(s => { if (mounted) setStatus(s); });
    const unsub = api.events.onBotStatus((s) => setStatus(s));
    return () => { mounted = false; unsub(); };
  }, []);

  useEffect(() => {
    if (!status) return;
    if (status.kind === 'unconfigured') navigate('/onboarding', { replace: true });
    else navigate('/shell', { replace: true });
  }, [status, navigate]);

  return <div className="p-6 text-fg-muted">Loading…</div>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<StatusGate />} />
          <Route path="/onboarding" element={<OnboardingRoute />} />
          <Route path="/shell" element={<ShellRoute />} />
          <Route path="/compose" element={<ComposeRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Replace `src/renderer/main.tsx`**

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 5: Create stub route files so it compiles** — these get filled in by later tasks.

`src/renderer/routes/onboarding/OnboardingRoute.tsx`:

```tsx
export function OnboardingRoute() {
  return <div className="p-6">Onboarding placeholder</div>;
}
```

`src/renderer/routes/shell/ShellRoute.tsx`:

```tsx
export function ShellRoute() {
  return <div className="p-6">Shell placeholder</div>;
}
```

`src/renderer/routes/compose/ComposeRoute.tsx`:

```tsx
export function ComposeRoute() {
  return <div className="p-6">Compose placeholder</div>;
}
```

- [ ] **Step 6: Smoke test**

Run: `pnpm dev`
Expected: window opens, briefly shows "Loading…", then routes to "Onboarding placeholder" because no token is configured.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(renderer): router, query client, status-gated routing"
```

---

## Task 16: Onboarding wizard

**Files:**
- Create: `src/renderer/routes/onboarding/steps/Step1Application.tsx`
- Create: `src/renderer/routes/onboarding/steps/Step2BotUser.tsx`
- Create: `src/renderer/routes/onboarding/steps/Step3Intents.tsx`
- Create: `src/renderer/routes/onboarding/steps/Step4Invite.tsx`
- Create: `src/renderer/routes/onboarding/steps/Step5Token.tsx`
- Modify: `src/renderer/routes/onboarding/OnboardingRoute.tsx`
- Create: `resources/onboarding/.gitkeep`

- [ ] **Step 1: Create the placeholder image directory**

```bash
mkdir -p resources/onboarding
touch resources/onboarding/.gitkeep
```

The wizard references screenshots that don't exist yet. We render an `<img>` tag with `onerror` swap to a styled placeholder, so the wizard works without real images.

- [ ] **Step 2: Create `src/renderer/components/Placeholder.tsx`**

```tsx
import { useState } from 'react';

export function ScreenshotSlot({ name, alt }: { name: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-sunken h-48 flex items-center justify-center text-fg-muted text-sm">
        [Screenshot placeholder: {name}]
      </div>
    );
  }
  return (
    <img
      src={`./resources/onboarding/${name}.png`}
      alt={alt}
      className="rounded-md border border-border max-h-64 object-contain bg-bg-sunken"
      onError={() => setFailed(true)}
    />
  );
}
```

- [ ] **Step 3: Create `src/renderer/routes/onboarding/steps/Step1Application.tsx`**

```tsx
import { api } from '../../../lib/api';
import { ScreenshotSlot } from '../../../components/Placeholder';

export function Step1Application({ onNext }: { onNext: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">1. Create a Discord application</h2>
      <p className="text-fg-muted">
        Open the Discord Developer Portal and click "New Application". Pick a name — this is what your bot will be called.
      </p>
      <ScreenshotSlot name="step-1-new-application" alt="Developer portal new application button" />
      <div className="flex gap-2">
        <button
          className="px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover"
          onClick={() => api.system.openExternal('https://discord.com/developers/applications')}
        >
          Open Developer Portal
        </button>
        <button className="px-3 py-2 rounded border border-border hover:bg-bg-subtle" onClick={onNext}>
          I've created an application →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/renderer/routes/onboarding/steps/Step2BotUser.tsx`**

```tsx
import { ScreenshotSlot } from '../../../components/Placeholder';

export function Step2BotUser({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">2. Add a bot user</h2>
      <p className="text-fg-muted">
        In your application's left sidebar, click <strong>Bot</strong>. Discord will create a bot user for the application automatically.
      </p>
      <ScreenshotSlot name="step-2-bot-tab" alt="Bot tab in the developer portal sidebar" />
      <div className="flex gap-2">
        <button className="px-3 py-2 rounded border border-border hover:bg-bg-subtle" onClick={onBack}>← Back</button>
        <button className="px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover" onClick={onNext}>Next →</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `src/renderer/routes/onboarding/steps/Step3Intents.tsx`**

```tsx
import { ScreenshotSlot } from '../../../components/Placeholder';

export function Step3Intents({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">3. Enable privileged intents</h2>
      <p className="text-fg-muted">On the Bot tab, scroll to <strong>Privileged Gateway Intents</strong> and toggle all three on:</p>
      <ul className="list-disc pl-6 text-fg-muted space-y-1">
        <li><strong>Presence Intent</strong> — required to see members come online.</li>
        <li><strong>Server Members Intent</strong> — required to list members and resolve mentions.</li>
        <li><strong>Message Content Intent</strong> — required to read message bodies for history and bulk-delete.</li>
      </ul>
      <ScreenshotSlot name="step-3-intents" alt="Privileged Gateway Intents toggles" />
      <div className="flex gap-2">
        <button className="px-3 py-2 rounded border border-border hover:bg-bg-subtle" onClick={onBack}>← Back</button>
        <button className="px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover" onClick={onNext}>Next →</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `src/renderer/routes/onboarding/steps/Step4Invite.tsx`**

```tsx
import { useState } from 'react';
import { api } from '../../../lib/api';

export function Step4Invite({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const generate = async () => {
    setError(null);
    const res = await api.bot.buildInviteUrl(clientId.trim());
    if (!res.ok) { setError(res.error.message); return; }
    setInviteUrl(res.data);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">4. Invite the bot to your server</h2>
      <p className="text-fg-muted">
        On the General Information tab in the developer portal, copy your <strong>Application (Client) ID</strong> and paste it here.
      </p>
      <input
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        placeholder="123456789012345678"
        className="w-full bg-bg-sunken border border-border rounded px-3 py-2 font-mono"
      />
      <button className="px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover" onClick={generate}>
        Generate invite URL
      </button>
      {error && <div className="text-danger text-sm">{error}</div>}
      {inviteUrl && (
        <div className="space-y-2">
          <code className="block break-all text-xs bg-bg-sunken p-2 rounded border border-border">{inviteUrl}</code>
          <button
            className="px-3 py-2 rounded border border-border hover:bg-bg-subtle"
            onClick={() => api.system.openExternal(inviteUrl)}
          >
            Open invite in browser
          </button>
        </div>
      )}
      <div className="flex gap-2 pt-4">
        <button className="px-3 py-2 rounded border border-border hover:bg-bg-subtle" onClick={onBack}>← Back</button>
        <button
          className="px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
          disabled={!inviteUrl}
          onClick={onNext}
        >
          I've invited the bot →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create `src/renderer/routes/onboarding/steps/Step5Token.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';

export function Step5Token({ onBack, goToIntents }: { onBack: () => void; goToIntents: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const navigate = useNavigate();

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await api.bot.saveToken(token.trim());
    setBusy(false);
    if (!res.ok) {
      setError({ code: res.error.code, message: res.error.message });
      return;
    }
    navigate('/shell', { replace: true });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">5. Paste your bot token</h2>
      <p className="text-fg-muted">
        On the Bot tab, click <strong>Reset Token</strong> (or <strong>Copy</strong> if you've never used it). Paste the token below.
        It's encrypted with your OS keychain and never leaves this machine.
      </p>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Bot token"
        className="w-full bg-bg-sunken border border-border rounded px-3 py-2 font-mono"
        autoComplete="off"
        spellCheck={false}
      />
      {error && (
        <div className="rounded border border-danger/50 bg-danger/10 p-3 text-sm space-y-2">
          <div className="text-danger font-medium">Couldn't connect: {error.code}</div>
          <div className="text-fg-muted">{error.message}</div>
          {error.code === 'MISSING_INTENTS' && (
            <button className="text-accent underline" onClick={goToIntents}>← Back to intents step</button>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button className="px-3 py-2 rounded border border-border hover:bg-bg-subtle" onClick={onBack} disabled={busy}>← Back</button>
        <button
          className="px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
          onClick={submit}
          disabled={busy || !token.trim()}
        >
          {busy ? 'Connecting…' : 'Save and connect'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Replace `src/renderer/routes/onboarding/OnboardingRoute.tsx`**

```tsx
import { useState } from 'react';
import { Step1Application } from './steps/Step1Application';
import { Step2BotUser } from './steps/Step2BotUser';
import { Step3Intents } from './steps/Step3Intents';
import { Step4Invite } from './steps/Step4Invite';
import { Step5Token } from './steps/Step5Token';

const TOTAL = 5;

export function OnboardingRoute() {
  const [step, setStep] = useState(1);
  const next = () => setStep(s => Math.min(TOTAL, s + 1));
  const back = () => setStep(s => Math.max(1, s - 1));

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-bg-subtle border border-border rounded-lg p-6 shadow-lg">
        <div className="flex items-center gap-2 mb-6 text-xs text-fg-muted">
          {Array.from({ length: TOTAL }, (_, i) => i + 1).map(n => (
            <div key={n} className={`flex-1 h-1 rounded ${n <= step ? 'bg-accent' : 'bg-border'}`} />
          ))}
        </div>
        {step === 1 && <Step1Application onNext={next} />}
        {step === 2 && <Step2BotUser onNext={next} onBack={back} />}
        {step === 3 && <Step3Intents onNext={next} onBack={back} />}
        {step === 4 && <Step4Invite onNext={next} onBack={back} />}
        {step === 5 && <Step5Token onBack={back} goToIntents={() => setStep(3)} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Smoke test**

Run: `pnpm dev`
Expected: app routes to onboarding. Click through steps 1-4. On step 4, type any 18-digit number and verify invite URL renders. On step 5, pasting an obviously bad token like `abc` and clicking Save shows an INVALID_TOKEN error. Don't paste a real token unless you have a test bot ready.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(onboarding): five-step wizard with placeholder screenshots"
```

---

## Task 17: Three-pane shell with status pill and toasts

**Files:**
- Create: `src/renderer/components/Toaster.tsx`
- Create: `src/renderer/components/StatusPill.tsx`
- Create: `src/renderer/components/GuildList.tsx`
- Create: `src/renderer/components/ChannelList.tsx`
- Create: `src/renderer/components/SettingsPanel.tsx`
- Modify: `src/renderer/routes/shell/ShellRoute.tsx`

- [ ] **Step 1: Create `src/renderer/components/Toaster.tsx`**

A minimal in-app toast system. Other components push transient messages via the exported `pushToast` function.

```tsx
import { useEffect, useState } from 'react';

type Toast = { id: number; kind: 'info' | 'ok' | 'warn' | 'danger'; text: string };
const listeners = new Set<(t: Toast) => void>();
let nextId = 1;

export function pushToast(kind: Toast['kind'], text: string): void {
  const t: Toast = { id: nextId++, kind, text };
  for (const cb of listeners) cb(t);
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (t: Toast) => {
      setToasts(prev => [...prev, t]);
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 4000);
    };
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  return (
    <div className="fixed bottom-4 right-4 space-y-2 z-50">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`px-3 py-2 rounded text-sm border shadow-lg max-w-sm ${
            t.kind === 'ok' ? 'bg-ok/10 border-ok/40 text-ok' :
            t.kind === 'warn' ? 'bg-warn/10 border-warn/40 text-warn' :
            t.kind === 'danger' ? 'bg-danger/10 border-danger/40 text-danger' :
            'bg-bg-subtle border-border text-fg'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/renderer/components/StatusPill.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { GatewayState } from '../../shared/domain';
import { pushToast } from './Toaster';

const COLORS: Record<GatewayState['status'], string> = {
  ready: 'bg-ok',
  connecting: 'bg-warn',
  reconnecting: 'bg-warn',
  disconnected: 'bg-danger',
};

const LABELS: Record<GatewayState['status'], (s: GatewayState) => string> = {
  ready: () => 'Connected',
  connecting: () => 'Connecting…',
  reconnecting: (s) => s.status === 'reconnecting' ? `Reconnecting (attempt ${s.attempt})` : 'Reconnecting',
  disconnected: () => 'Disconnected',
};

const TOAST_FOR: Partial<Record<GatewayState['status'], { kind: 'ok' | 'warn' | 'danger'; text: string }>> = {
  ready: { kind: 'ok', text: 'Bot connected' },
  reconnecting: { kind: 'warn', text: 'Reconnecting to Discord…' },
  disconnected: { kind: 'danger', text: 'Disconnected from Discord' },
};

export function StatusPill() {
  const [state, setState] = useState<GatewayState>({ status: 'connecting' });
  const prev = useRef<GatewayState['status'] | null>(null);

  useEffect(() => {
    api.bot.getStatus().then(s => {
      if (s.kind === 'configured') setState(s.gateway);
    });
    return api.events.onGatewayState(setState);
  }, []);

  useEffect(() => {
    if (prev.current !== null && prev.current !== state.status) {
      const t = TOAST_FOR[state.status];
      if (t) pushToast(t.kind, t.text);
    }
    prev.current = state.status;
  }, [state.status]);

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`inline-block w-2 h-2 rounded-full ${COLORS[state.status]}`} />
      <span className="text-fg-muted">{LABELS[state.status](state)}</span>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/renderer/components/GuildList.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { GuildSummary } from '../../shared/domain';

export function GuildList({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await api.guilds.list();
      if (!active) return;
      if (res.ok) { setGuilds(res.data); setError(null); }
      else setError(res.error.message);
    };
    load();
    const unsub = api.events.onGuildUpdate(() => load());
    const unsubGw = api.events.onGatewayState((s) => { if (s.status === 'ready') load(); });
    return () => { active = false; unsub(); unsubGw(); };
  }, []);

  return (
    <div className="h-full overflow-y-auto p-2 space-y-1">
      {error && <div className="text-danger text-xs px-2 py-1">{error}</div>}
      {guilds.map(g => (
        <button
          key={g.id}
          onClick={() => onSelect(g.id)}
          className={`w-full flex items-center gap-2 px-2 py-2 rounded text-left text-sm
            ${selected === g.id ? 'bg-bg-subtle' : 'hover:bg-bg-subtle/50'}`}
        >
          {g.iconUrl
            ? <img src={g.iconUrl} alt="" className="w-7 h-7 rounded-full" />
            : <div className="w-7 h-7 rounded-full bg-border flex items-center justify-center text-xs">
                {g.name.slice(0, 2).toUpperCase()}
              </div>}
          <span className="truncate">{g.name}</span>
        </button>
      ))}
      {guilds.length === 0 && !error && (
        <div className="text-fg-muted text-xs px-2 py-1">No guilds. Invite the bot to a server.</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `src/renderer/components/ChannelList.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ChannelSummary } from '../../shared/domain';

export function ChannelList({ guildId, selected, onSelect }: { guildId: string | null; selected: string | null; onSelect: (id: string) => void }) {
  const [channels, setChannels] = useState<ChannelSummary[]>([]);

  useEffect(() => {
    if (!guildId) { setChannels([]); return; }
    let active = true;
    const load = async () => {
      const res = await api.guilds.listChannels(guildId);
      if (!active) return;
      if (res.ok) setChannels(res.data);
    };
    load();
    const unsub = api.events.onChannelUpdate((c) => { if (c.guildId === guildId) load(); });
    return () => { active = false; unsub(); };
  }, [guildId]);

  if (!guildId) return <div className="p-3 text-fg-muted text-sm">Select a server.</div>;

  const sorted = [...channels].sort((a, b) => a.position - b.position);

  return (
    <div className="h-full overflow-y-auto p-2 space-y-0.5">
      {sorted.map(c => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm
            ${selected === c.id ? 'bg-bg-subtle' : 'hover:bg-bg-subtle/50'}`}
        >
          <span className="text-fg-muted text-xs w-4 inline-block">{kindGlyph(c.type)}</span>
          <span className="truncate">{c.name}</span>
        </button>
      ))}
    </div>
  );
}

function kindGlyph(t: ChannelSummary['type']): string {
  switch (t) {
    case 'text': return '#';
    case 'announcement': return '📢';
    case 'voice': return '🔊';
    case 'thread': return '↳';
    case 'category': return '▾';
    case 'forum': return '☰';
    default: return '·';
  }
}
```

- [ ] **Step 5: Create `src/renderer/components/SettingsPanel.tsx`**

```tsx
import { useState } from 'react';
import { api } from '../lib/api';
import { useNavigate } from 'react-router-dom';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const reset = async () => {
    if (!confirm('Reset bot token? You will need to re-paste it on next launch.')) return;
    setBusy(true);
    await api.bot.clearToken();
    setBusy(false);
    navigate('/onboarding', { replace: true });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg-subtle border border-border rounded-lg p-6 w-96 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Settings</h2>
        <div className="space-y-2">
          <button
            className="w-full px-3 py-2 rounded border border-danger/50 text-danger hover:bg-danger/10 disabled:opacity-50"
            onClick={reset}
            disabled={busy}
          >
            Reset bot token
          </button>
        </div>
        <button className="w-full px-3 py-2 rounded border border-border hover:bg-bg-sunken" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Replace `src/renderer/routes/shell/ShellRoute.tsx`**

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GuildList } from '../../components/GuildList';
import { ChannelList } from '../../components/ChannelList';
import { StatusPill } from '../../components/StatusPill';
import { SettingsPanel } from '../../components/SettingsPanel';
import { Toaster } from '../../components/Toaster';

export function ShellRoute() {
  const [guildId, setGuildId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="h-full flex flex-col">
      <header className="h-10 border-b border-border flex items-center justify-between px-3 bg-bg-subtle">
        <div className="font-semibold tracking-tight">BotCord</div>
        <div className="flex items-center gap-3">
          <StatusPill />
          <button className="text-xs text-fg-muted hover:text-fg" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </header>
      <div className="flex-1 grid grid-cols-[220px_240px_1fr] min-h-0">
        <aside className="border-r border-border bg-bg-sunken min-h-0">
          <GuildList selected={guildId} onSelect={(id) => { setGuildId(id); setChannelId(null); }} />
        </aside>
        <aside className="border-r border-border min-h-0">
          <ChannelList guildId={guildId} selected={channelId} onSelect={setChannelId} />
        </aside>
        <main className="p-6 overflow-y-auto">
          {channelId ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Channel selected</h2>
              <p className="text-fg-muted text-sm">Select an action:</p>
              <Link
                to="/compose"
                className="inline-block px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover"
              >
                Open embed composer
              </Link>
            </div>
          ) : (
            <p className="text-fg-muted">Select a channel to begin.</p>
          )}
        </main>
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      <Toaster />
    </div>
  );
}
```

- [ ] **Step 7: Smoke test (requires a real bot)**

Set up a test bot by running through the onboarding wizard with a real token, and confirm:

1. Status pill goes yellow → green as the gateway connects.
2. Left pane lists guilds the bot is in.
3. Selecting a guild populates channels in the middle pane.
4. Settings → Reset bot token returns you to the onboarding wizard.

If you don't have a test bot, you can still verify routing by skipping past step 5 of onboarding manually (e.g. pasting a fake token returns INVALID_TOKEN — which is the correct behavior).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(shell): three-pane layout with status pill, toasts, and settings"
```

---

## Task 18: Compose route stub and final polish

**Files:**
- Modify: `src/renderer/routes/compose/ComposeRoute.tsx`

- [ ] **Step 1: Replace `src/renderer/routes/compose/ComposeRoute.tsx`**

```tsx
import { Link } from 'react-router-dom';

export function ComposeRoute() {
  return (
    <div className="min-h-full p-8">
      <Link to="/shell" className="text-sm text-accent hover:underline">← Back to shell</Link>
      <div className="mt-8 max-w-xl">
        <h1 className="text-2xl font-semibold mb-2">Embed composer</h1>
        <p className="text-fg-muted">Coming next session.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Final full-app smoke test**

Run: `pnpm dev`
Expected:
1. Fresh launch with no token → onboarding wizard.
2. Walk through wizard with a real test bot → lands on shell.
3. Status pill green; guilds visible; channels visible after selecting a guild.
4. "Open embed composer" navigates to `/compose` placeholder.
5. Settings → Reset clears token and returns to onboarding.
6. DevTools console: zero CSP violations; `window.require` is undefined.

- [ ] **Step 3: Run full test + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(compose): stub route placeholder for next-session embed composer"
```

---

## Verification checklist

Before considering the foundation done, confirm each:

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes — vault, permissions, db, repos
- [ ] `pnpm dev` launches; fresh install routes to `/onboarding`
- [ ] Wizard steps 1–4 navigate without errors; step 4 generates an invite URL
- [ ] Pasting an invalid token at step 5 surfaces `INVALID_TOKEN`
- [ ] With a real test bot, app reaches the three-pane shell with green status pill
- [ ] Guild and channel data appears in the left and middle panes
- [ ] Settings → Reset bot token returns to `/onboarding`
- [ ] DevTools console shows no CSP violations
- [ ] `window.require` and `window.process` are `undefined` in the renderer

If any verification step fails, fix it before declaring the task complete.
