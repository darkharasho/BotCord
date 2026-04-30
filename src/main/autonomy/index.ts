import type { CDKEvent } from '@claude-cdk/core';
import type { GuildAutonomyConfig, GlobalAutonomyConfig } from '../../shared/domain';
import { DEFAULT_GLOBAL_SYSTEM_PROMPT } from '../../shared/domain';
import type { AutonomyHost, AutonomySession, ChannelHistoryEntry, PromptInputs } from './types';
import { buildPrompt } from './prompt';
import { postProcess } from './post-process';
import { createThrottle, type Throttle } from './throttle';

export type AutonomyEvents = {
  onDelta: (requestId: string, delta: string) => void;
  onDone: (requestId: string, text: string, stopReason: string | undefined) => void;
};

export type DraftRequest = {
  requestId: string;
  channelMeta: { guildName: string; channelName: string; channelTopic: string | null };
  history: ChannelHistoryEntry[];
  target: ChannelHistoryEntry & { id: string };
};

export type DraftResult =
  | { ok: true; text: string; stopReason: string | undefined }
  | { ok: false; error: string };

export type RunAutonomousRequest = {
  guildId: string;
  channelId: string;
  channelMeta: DraftRequest['channelMeta'];
  history: ChannelHistoryEntry[];
  target: DraftRequest['target'];
};

export type RunAutonomousResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'global-disabled' | 'guild-disabled' | 'not-allowed' | 'rate-cap' | 'cli-missing' | 'empty-output' | 'host-error' | 'dropped'; message?: string };

export type AutonomyModule = {
  draftReply(req: DraftRequest): Promise<DraftResult>;
  runAutonomous(req: RunAutonomousRequest): Promise<RunAutonomousResult>;
  abortChannel(channelId: string): void;
  cancelDraft(requestId: string): Promise<void>;
};

type CreateOpts = {
  host: AutonomyHost;
  globalConfig: () => GlobalAutonomyConfig;
  guildConfig: (guildId: string) => GuildAutonomyConfig;
  cwd: string;
  events: AutonomyEvents;
  now?: () => number;
  /**
   * Per-channel queue policy. Items beyond `maxDepth` drop the oldest.
   * Items older than `ttlMs` are dropped before processing — past that
   * the conversation context has likely moved on.
   */
  queue?: { maxDepth?: number; ttlMs?: number; pollMs?: number };
};

const DEFAULT_QUEUE_DEPTH = 5;
const DEFAULT_QUEUE_TTL_MS = 30_000;
const DEFAULT_QUEUE_POLL_MS = 500;

type QueueItem = {
  req: RunAutonomousRequest;
  enqueuedAt: number;
  resolve: (r: RunAutonomousResult) => void;
};

export function createAutonomyModule(opts: CreateOpts): AutonomyModule {
  const now = opts.now ?? (() => Date.now());
  const maxDepth = opts.queue?.maxDepth ?? DEFAULT_QUEUE_DEPTH;
  const ttlMs = opts.queue?.ttlMs ?? DEFAULT_QUEUE_TTL_MS;
  const pollMs = opts.queue?.pollMs ?? DEFAULT_QUEUE_POLL_MS;

  const throttle: Throttle = createThrottle({
    rateCapPerMin: () => opts.globalConfig().rateCapPerMin,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });

  const draftSessions = new Map<string, AutonomySession>();
  const channelSessions = new Map<string, AutonomySession>();

  const queues = new Map<string, QueueItem[]>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const resolveSystemPrompt = (guildId: string | null): string => {
    const g = opts.globalConfig();
    if (!guildId) return g.systemPrompt || DEFAULT_GLOBAL_SYSTEM_PROMPT;
    const cfg = opts.guildConfig(guildId);
    if (cfg.systemPrompt && cfg.systemPrompt.trim().length > 0) return cfg.systemPrompt;
    return g.systemPrompt || DEFAULT_GLOBAL_SYSTEM_PROMPT;
  };

  const collectText = async (
    session: AutonomySession,
    prompt: string,
    onDelta?: (delta: string) => void,
  ): Promise<{ text: string; stopReason: string | undefined }> => {
    let text = '';
    let stopReason: string | undefined;
    for await (const ev of session.send(prompt) as AsyncIterable<CDKEvent>) {
      if (ev.type === 'assistant.text_delta') {
        text += ev.delta;
        onDelta?.(ev.delta);
      } else if (ev.type === 'session.done') {
        stopReason = ev.stopReason;
      }
    }
    return { text, stopReason };
  };

  const processItem = async (item: QueueItem): Promise<RunAutonomousResult> => {
    const { req } = item;
    const sysPrompt = resolveSystemPrompt(req.guildId);
    const prompt = buildPrompt({
      systemPrompt: sysPrompt,
      channelMeta: req.channelMeta,
      history: req.history,
      target: req.target,
    });

    let session: AutonomySession;
    try {
      const model = opts.globalConfig().model;
      session = await opts.host.startSession({ cwd: opts.cwd, ...(model ? { model } : {}) });
    } catch (e) {
      return { ok: false, reason: 'host-error', message: e instanceof Error ? e.message : String(e) };
    }
    channelSessions.set(req.channelId, session);
    try {
      const { text } = await collectText(session, prompt);
      const cleaned = postProcess(text);
      if (!cleaned) return { ok: false, reason: 'empty-output' };
      return { ok: true, text: cleaned };
    } catch (e) {
      return { ok: false, reason: 'host-error', message: e instanceof Error ? e.message : String(e) };
    } finally {
      channelSessions.delete(req.channelId);
      try { await session.close(); } catch { /* ignore */ }
    }
  };

  const schedule = (channelId: string, delayMs: number) => {
    if (timers.has(channelId)) return;
    const t = setTimeout(() => {
      timers.delete(channelId);
      void tryProcess(channelId);
    }, delayMs);
    timers.set(channelId, t);
  };

  const drainAll = (channelId: string, reason: RunAutonomousResult & { ok: false }) => {
    const q = queues.get(channelId);
    if (!q) return;
    while (q.length > 0) q.shift()!.resolve(reason);
    queues.delete(channelId);
    const t = timers.get(channelId);
    if (t) { clearTimeout(t); timers.delete(channelId); }
  };

  const tryProcess = async (channelId: string): Promise<void> => {
    const q = queues.get(channelId);
    if (!q || q.length === 0) { queues.delete(channelId); return; }

    // Drop stale items.
    const t = now();
    while (q.length > 0 && t - q[0]!.enqueuedAt > ttlMs) {
      const stale = q.shift()!;
      stale.resolve({ ok: false, reason: 'dropped', message: 'queue TTL expired' });
    }
    if (q.length === 0) { queues.delete(channelId); return; }

    // Re-check policy gates against current config — they may have changed
    // while items were waiting (kill switch flipped, channel deallowlisted).
    const g = opts.globalConfig();
    if (!g.enabled) { drainAll(channelId, { ok: false, reason: 'global-disabled' }); return; }
    const head = q[0]!;
    const cfg = opts.guildConfig(head.req.guildId);
    if (!cfg.enabled) { drainAll(channelId, { ok: false, reason: 'guild-disabled' }); return; }
    if (!cfg.channelIds.includes(channelId)) { drainAll(channelId, { ok: false, reason: 'not-allowed' }); return; }

    const start = throttle.tryStart(channelId, cfg.cooldownMs);
    if (start !== 'ok') {
      // Blocked — retry later. For in-flight, the running item's finally
      // will re-trigger. For cooldown/rate-cap, poll until clear.
      if (start !== 'in-flight') schedule(channelId, pollMs);
      return;
    }

    const item = q.shift()!;
    if (q.length === 0) queues.delete(channelId);

    void processItem(item).then(result => {
      item.resolve(result);
      throttle.finish(channelId);
      // Drain next if any items remain.
      if (queues.has(channelId)) void tryProcess(channelId);
    });
  };

  return {
    async draftReply(req) {
      const sysPrompt = resolveSystemPrompt(null);
      const inputs: PromptInputs = {
        systemPrompt: sysPrompt,
        channelMeta: req.channelMeta,
        history: req.history,
        target: req.target,
      };
      const prompt = buildPrompt(inputs);

      let session: AutonomySession;
      try {
        const model = opts.globalConfig().model;
        session = await opts.host.startSession({ cwd: opts.cwd, ...(model ? { model } : {}) });
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      draftSessions.set(req.requestId, session);
      try {
        const { text, stopReason } = await collectText(session, prompt, (d) => opts.events.onDelta(req.requestId, d));
        opts.events.onDone(req.requestId, text, stopReason);
        return { ok: true, text, stopReason };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      } finally {
        draftSessions.delete(req.requestId);
        try { await session.close(); } catch { /* ignore */ }
      }
    },

    async runAutonomous(req) {
      // Quick gate-checks before queueing — saves a queue slot for items
      // that have no chance of being processed.
      const g = opts.globalConfig();
      if (!g.enabled) return { ok: false, reason: 'global-disabled' };
      const cfg = opts.guildConfig(req.guildId);
      if (!cfg.enabled) return { ok: false, reason: 'guild-disabled' };
      if (!cfg.channelIds.includes(req.channelId)) return { ok: false, reason: 'not-allowed' };

      // Enqueue and schedule processing.
      let q = queues.get(req.channelId);
      if (!q) { q = []; queues.set(req.channelId, q); }
      if (q.length >= maxDepth) {
        const dropped = q.shift()!;
        dropped.resolve({ ok: false, reason: 'dropped', message: 'queue full' });
      }

      return new Promise<RunAutonomousResult>(resolve => {
        q!.push({ req, enqueuedAt: now(), resolve });
        void tryProcess(req.channelId);
      });
    },

    abortChannel(channelId) {
      const s = channelSessions.get(channelId);
      if (s) void s.abort().catch(() => {});
    },

    async cancelDraft(requestId) {
      const s = draftSessions.get(requestId);
      if (s) {
        try { await s.abort(); } catch { /* ignore */ }
      }
    },
  };
}
