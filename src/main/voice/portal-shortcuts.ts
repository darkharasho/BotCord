import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';

/**
 * XDG GlobalShortcuts portal client.
 *
 * The portal lives at:
 *   service:   org.freedesktop.portal.Desktop
 *   path:      /org/freedesktop/portal/desktop
 *   interface: org.freedesktop.portal.GlobalShortcuts
 *
 * Spec: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html
 *
 * Initializes lazily — we don't touch dbus-next or the session bus until
 * `bind()` is first called. That means non-Linux platforms can import this
 * module safely and `bind()` will simply fail gracefully if the portal /
 * dbus-next aren't reachable.
 */

const PORTAL_SERVICE = 'org.freedesktop.portal.Desktop';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const SHORTCUTS_IFACE = 'org.freedesktop.portal.GlobalShortcuts';
const REQUEST_IFACE = 'org.freedesktop.portal.Request';
const SESSION_IFACE = 'org.freedesktop.portal.Session';

const SHORTCUT_ID = 'botcord-ptt';

// Static introspection XML for portal.Request and portal.Session objects.
// The portal's transient Request objects don't reliably reply to Introspect
// with the Request interface, so dbus-next can't find it via getProxyObject.
// Passing the XML directly bypasses the Introspect call.
const REQUEST_INTROSPECT = `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="org.freedesktop.portal.Request">
    <method name="Close"/>
    <signal name="Response">
      <arg type="u" name="response"/>
      <arg type="a{sv}" name="results"/>
    </signal>
  </interface>
</node>`;

const SESSION_INTROSPECT = `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="org.freedesktop.portal.Session">
    <method name="Close"/>
    <signal name="Closed"/>
  </interface>
</node>`;

// Subset of the dbus-next surface we need. Loaded dynamically so this module
// is safe to import on platforms where dbus-next can't initialize.
type DbusNext = typeof import('dbus-next');
type MessageBus = ReturnType<DbusNext['sessionBus']>;
type ProxyObject = Awaited<ReturnType<MessageBus['getProxyObject']>>;
type ClientInterface = ReturnType<ProxyObject['getInterface']>;

interface PortalStatus {
  sessionActive: boolean;
  lastError: string | null;
  activations: number;
}

/**
 * Translate an Electron-style accelerator (e.g. "Control+Shift+Space", "F18",
 * "A") into the portal's preferred_trigger format.
 *
 * Per the spec: modifiers (CTRL, SHIFT, ALT, LOGO) and a key joined by '+'.
 * Letter keys are lowercase X11 keysym names. Special keys can be wrapped
 * with `<…>` (e.g. `<F18>`). For F-keys we emit the angle-bracket form;
 * the spec accepts that form for special keysyms.
 *
 * Returns `null` for accelerators we can't confidently translate — callers
 * should treat that as "fail gracefully, don't bind".
 */
export function translateAccelerator(accelerator: string): string | null {
  if (!accelerator || typeof accelerator !== 'string') return null;

  const parts = accelerator.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const modifiers: string[] = [];
  let key: string | null = null;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const lower = part.toLowerCase();
    const isLast = i === parts.length - 1;

    // Modifier mapping. Electron uses Ctrl/Control/CommandOrControl/Cmd,
    // Shift, Alt/Option, Super/Meta/Cmd. We map them to portal modifiers.
    if (!isLast || (parts.length > 1 && (lower === 'ctrl' || lower === 'control' || lower === 'commandorcontrol' || lower === 'cmdorctrl' || lower === 'shift' || lower === 'alt' || lower === 'option' || lower === 'super' || lower === 'meta' || lower === 'cmd' || lower === 'command'))) {
      switch (lower) {
        case 'ctrl':
        case 'control':
        case 'commandorcontrol':
        case 'cmdorctrl':
          modifiers.push('CTRL');
          continue;
        case 'shift':
          modifiers.push('SHIFT');
          continue;
        case 'alt':
        case 'option':
          modifiers.push('ALT');
          continue;
        case 'super':
        case 'meta':
        case 'cmd':
        case 'command':
          modifiers.push('LOGO');
          continue;
        default:
          // Not a modifier — fall through to key handling, but only if last.
          if (!isLast) return null;
      }
    }

    // Last part — the key.
    if (isLast) {
      key = translateKey(part);
      if (!key) return null;
    }
  }

  if (!key) return null;

  // Dedupe modifiers, preserve canonical order.
  const order = ['CTRL', 'SHIFT', 'ALT', 'LOGO'];
  const seen = new Set(modifiers);
  const ordered = order.filter((m) => seen.has(m));

  return ordered.length > 0 ? `${ordered.join('+')}+${key}` : key;
}

function translateKey(raw: string): string | null {
  if (!raw) return null;

  // Function keys F1..F35 — wrap with angle brackets per spec for special
  // keysyms.
  const fnMatch = /^F(\d{1,2})$/i.exec(raw);
  if (fnMatch) {
    const n = parseInt(fnMatch[1], 10);
    if (n >= 1 && n <= 35) return `<F${n}>`;
    return null;
  }

  // Single character — letter or digit.
  if (raw.length === 1) {
    const ch = raw;
    if (/[a-zA-Z]/.test(ch)) return ch.toLowerCase();
    if (/[0-9]/.test(ch)) return ch;
    return null;
  }

  // Named special keys → X11 keysym names (lowercase).
  const lower = raw.toLowerCase();
  const named: Record<string, string> = {
    space: 'space',
    tab: 'Tab',
    escape: 'Escape',
    esc: 'Escape',
    enter: 'Return',
    return: 'Return',
    backspace: 'BackSpace',
    delete: 'Delete',
    insert: 'Insert',
    home: 'Home',
    end: 'End',
    pageup: 'Page_Up',
    pagedown: 'Page_Down',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    plus: 'plus',
    minus: 'minus',
  };
  if (named[lower]) return named[lower];

  return null;
}

class PortalShortcuts extends EventEmitter {
  private bus: MessageBus | null = null;
  private dbus: DbusNext | null = null;
  private sessionPath: string | null = null;
  private sessionIface: ClientInterface | null = null;
  private shortcutsIface: ClientInterface | null = null;
  private boundAccelerator: string | null = null;
  private status: PortalStatus = {
    sessionActive: false,
    lastError: null,
    activations: 0,
  };

  // Active Activated/Deactivated listeners on the GlobalShortcuts interface,
  // tracked so we can remove them on unbind.
  private activatedHandler: ((...args: unknown[]) => void) | null = null;
  private deactivatedHandler: ((...args: unknown[]) => void) | null = null;

  getStatus(): PortalStatus {
    return { ...this.status };
  }

  async bind(accelerator: string): Promise<boolean> {
    // Always start fresh: unbind any prior session.
    if (this.sessionPath) {
      try {
        await this.unbind();
      } catch {
        // ignore
      }
    }

    const trigger = translateAccelerator(accelerator);
    if (!trigger) {
      this.status.lastError = `Could not translate accelerator: ${accelerator}`;
      return false;
    }

    if (process.platform !== 'linux') {
      this.status.lastError = 'GlobalShortcuts portal is Linux-only';
      return false;
    }

    try {
      await this.ensureBus();
    } catch (err) {
      this.status.lastError = `dbus-next unavailable: ${describeError(err)}`;
      return false;
    }

    if (!this.bus || !this.dbus) {
      this.status.lastError = 'D-Bus session bus unavailable';
      return false;
    }

    let portalProxy: ProxyObject;
    try {
      portalProxy = await this.bus.getProxyObject(PORTAL_SERVICE, PORTAL_PATH);
    } catch (err) {
      this.status.lastError = `Portal unreachable: ${describeError(err)}`;
      return false;
    }

    let shortcuts: ClientInterface;
    try {
      shortcuts = portalProxy.getInterface(SHORTCUTS_IFACE);
    } catch (err) {
      this.status.lastError = `GlobalShortcuts portal not implemented: ${describeError(err)}`;
      return false;
    }

    // Create session.
    let sessionHandle: string;
    try {
      sessionHandle = await this.createSession(shortcuts);
    } catch (err) {
      this.status.lastError = `CreateSession failed: ${describeError(err)}`;
      return false;
    }

    // Bind shortcuts.
    try {
      const accepted = await this.callBindShortcuts(shortcuts, sessionHandle, trigger);
      if (!accepted) {
        await this.closeSessionQuiet(sessionHandle);
        this.status.lastError = 'User denied or cancelled the binding';
        return false;
      }
    } catch (err) {
      await this.closeSessionQuiet(sessionHandle);
      this.status.lastError = `BindShortcuts failed: ${describeError(err)}`;
      return false;
    }

    // Wire up Activated / Deactivated signals.
    try {
      await this.attachSignals(shortcuts, sessionHandle);
    } catch (err) {
      await this.closeSessionQuiet(sessionHandle);
      this.status.lastError = `Failed to subscribe to signals: ${describeError(err)}`;
      return false;
    }

    // Cache the session interface so we can close it later.
    try {
      const sessionProxy = await (this.bus as unknown as {
        getProxyObject: (s: string, p: string, xml?: string) => Promise<ProxyObject>;
      }).getProxyObject(PORTAL_SERVICE, sessionHandle, SESSION_INTROSPECT);
      this.sessionIface = sessionProxy.getInterface(SESSION_IFACE);
    } catch {
      // Non-fatal — we can still emit signals; closing on unbind will just
      // skip the Close() call.
      this.sessionIface = null;
    }

    this.shortcutsIface = shortcuts;
    this.sessionPath = sessionHandle;
    this.boundAccelerator = accelerator;
    this.status.sessionActive = true;
    this.status.lastError = null;
    return true;
  }

  async unbind(): Promise<void> {
    const path = this.sessionPath;

    // Detach signal handlers.
    if (this.shortcutsIface) {
      if (this.activatedHandler) {
        try {
          this.shortcutsIface.off('Activated', this.activatedHandler);
        } catch {
          /* ignore */
        }
      }
      if (this.deactivatedHandler) {
        try {
          this.shortcutsIface.off('Deactivated', this.deactivatedHandler);
        } catch {
          /* ignore */
        }
      }
    }
    this.activatedHandler = null;
    this.deactivatedHandler = null;

    if (this.sessionIface) {
      try {
        await (this.sessionIface as unknown as { Close: () => Promise<void> }).Close();
      } catch {
        /* ignore */
      }
    } else if (path) {
      // Best-effort: try to grab and close the session.
      await this.closeSessionQuiet(path);
    }

    this.sessionIface = null;
    this.shortcutsIface = null;
    this.sessionPath = null;
    this.boundAccelerator = null;
    this.status.sessionActive = false;
  }

  // ---------- private helpers ----------

  private async ensureBus(): Promise<void> {
    if (this.bus && this.dbus) return;
    // Lazy require — keeps non-Linux platforms safe and avoids paying the
    // import cost until first bind().
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dbus: DbusNext = await import('dbus-next');
    this.dbus = dbus;
    this.bus = dbus.sessionBus();
  }

  private async createSession(shortcuts: ClientInterface): Promise<string> {
    if (!this.bus || !this.dbus) throw new Error('bus not initialized');
    const Variant = this.dbus.Variant;

    const handleToken = randomToken();
    const sessionHandleToken = randomToken();
    const expectedRequestPath = this.requestPathFor(handleToken);

    const responsePromise = this.waitForResponse(expectedRequestPath);

    const options = {
      handle_token: new Variant('s', handleToken),
      session_handle_token: new Variant('s', sessionHandleToken),
    };

    const returnedRequestPath = await (
      shortcuts as unknown as { CreateSession: (opts: object) => Promise<string> }
    ).CreateSession(options);

    // The actual returned request path is authoritative; subscribe there
    // instead of our guess if they differ.
    const result = await this.rerouteIfNeeded(returnedRequestPath, expectedRequestPath, responsePromise);

    if (result.response !== 0) {
      throw new Error(`CreateSession response code ${result.response}`);
    }
    const sessionHandle = result.results['session_handle'];
    const sessionPath = unwrapVariant(sessionHandle);
    if (typeof sessionPath !== 'string' || !sessionPath) {
      throw new Error('CreateSession did not return a session_handle');
    }
    return sessionPath;
  }

  private async callBindShortcuts(
    shortcuts: ClientInterface,
    sessionHandle: string,
    trigger: string,
  ): Promise<boolean> {
    if (!this.dbus) throw new Error('dbus not initialized');
    const Variant = this.dbus.Variant;

    const handleToken = randomToken();
    const expectedRequestPath = this.requestPathFor(handleToken);
    const responsePromise = this.waitForResponse(expectedRequestPath);

    const shortcutEntry: [string, Record<string, unknown>] = [
      SHORTCUT_ID,
      {
        description: new Variant('s', 'BotCord push-to-talk'),
        preferred_trigger: new Variant('s', trigger),
      },
    ];

    const options = {
      handle_token: new Variant('s', handleToken),
    };

    const returnedRequestPath = await (
      shortcuts as unknown as {
        BindShortcuts: (
          session: string,
          shortcuts: Array<[string, Record<string, unknown>]>,
          parentWindow: string,
          options: object,
        ) => Promise<string>;
      }
    ).BindShortcuts(sessionHandle, [shortcutEntry], '', options);

    const result = await this.rerouteIfNeeded(returnedRequestPath, expectedRequestPath, responsePromise);
    return result.response === 0;
  }

  private async attachSignals(shortcuts: ClientInterface, sessionHandle: string): Promise<void> {
    const onActivated = (session: string, shortcutId: string /* , timestamp, options */): void => {
      if (session !== sessionHandle) return;
      if (shortcutId !== SHORTCUT_ID) return;
      this.status.activations += 1;
      this.emit('activated');
    };
    const onDeactivated = (session: string, shortcutId: string /* , timestamp, options */): void => {
      if (session !== sessionHandle) return;
      if (shortcutId !== SHORTCUT_ID) return;
      this.emit('deactivated');
    };

    this.activatedHandler = onActivated as (...args: unknown[]) => void;
    this.deactivatedHandler = onDeactivated as (...args: unknown[]) => void;

    shortcuts.on('Activated', this.activatedHandler);
    shortcuts.on('Deactivated', this.deactivatedHandler);
  }

  private requestPathFor(handleToken: string): string {
    // Per the spec, the request path follows
    //   /org/freedesktop/portal/desktop/request/<SENDER>/<TOKEN>
    // where SENDER is the unique connection name with dots replaced by '_'
    // and the leading ':' stripped.
    const sender = (this.bus as unknown as { name?: string } | null)?.name ?? '';
    const cleaned = sender.replace(/^:/, '').replace(/\./g, '_');
    return `/org/freedesktop/portal/desktop/request/${cleaned}/${handleToken}`;
  }

  private async waitForResponse(
    requestPath: string,
  ): Promise<{ response: number; results: Record<string, unknown> }> {
    if (!this.bus) throw new Error('bus not initialized');
    // Pass static XML — the portal's Request objects don't reliably introspect
    // with the Request interface included, so we tell dbus-next directly what
    // the interface looks like.
    const proxy = await (this.bus as unknown as {
      getProxyObject: (s: string, p: string, xml?: string) => Promise<ProxyObject>;
    }).getProxyObject(PORTAL_SERVICE, requestPath, REQUEST_INTROSPECT);
    const iface = proxy.getInterface(REQUEST_IFACE);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        try {
          iface.off('Response', handler);
        } catch {
          /* ignore */
        }
        reject(new Error('Portal Response timed out'));
      }, 60_000);

      const handler = (response: number, results: Record<string, unknown>): void => {
        clearTimeout(timeout);
        try {
          iface.off('Response', handler);
        } catch {
          /* ignore */
        }
        resolve({ response, results: unwrapDict(results) });
      };
      iface.on('Response', handler);
    });
  }

  private async rerouteIfNeeded(
    actualPath: string,
    guessedPath: string,
    pending: Promise<{ response: number; results: Record<string, unknown> }>,
  ): Promise<{ response: number; results: Record<string, unknown> }> {
    if (actualPath === guessedPath) {
      return pending;
    }
    // Subscribe to the real path too. We race both — whichever fires first
    // wins. (In practice the predicted path is correct, but the spec
    // recommends using the returned path as the source of truth.)
    const real = this.waitForResponse(actualPath);
    return Promise.race([pending, real]);
  }

  private async closeSessionQuiet(sessionPath: string): Promise<void> {
    if (!this.bus) return;
    try {
      const proxy = await (this.bus as unknown as {
        getProxyObject: (s: string, p: string, xml?: string) => Promise<ProxyObject>;
      }).getProxyObject(PORTAL_SERVICE, sessionPath, SESSION_INTROSPECT);
      const iface = proxy.getInterface(SESSION_IFACE) as unknown as { Close: () => Promise<void> };
      await iface.Close();
    } catch {
      /* ignore */
    }
  }
}

function randomToken(): string {
  return `botcord_${randomBytes(8).toString('hex')}`;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return 'unknown error';
  }
}

function unwrapVariant(value: unknown): unknown {
  if (value && typeof value === 'object' && 'value' in (value as object) && 'signature' in (value as object)) {
    return (value as { value: unknown }).value;
  }
  return value;
}

function unwrapDict(dict: Record<string, unknown> | unknown): Record<string, unknown> {
  if (!dict || typeof dict !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dict as Record<string, unknown>)) {
    out[k] = unwrapVariant(v);
  }
  return out;
}

export const portalShortcuts = new PortalShortcuts();
export type { PortalStatus };
export { PortalShortcuts };
