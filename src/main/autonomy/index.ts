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
  | { ok: false; reason: 'global-disabled' | 'guild-disabled' | 'not-allowed' | 'cooldown' | 'in-flight' | 'rate-cap' | 'cli-missing' | 'empty-output' | 'host-error'; message?: string };

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
};

export function createAutonomyModule(opts: CreateOpts): AutonomyModule {
  const throttle: Throttle = createThrottle({
    rateCapPerMin: () => opts.globalConfig().rateCapPerMin,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });

  const draftSessions = new Map<string, AutonomySession>();
  const channelSessions = new Map<string, AutonomySession>();

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
        session = await opts.host.startSession({ cwd: opts.cwd });
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
      const g = opts.globalConfig();
      if (!g.enabled) return { ok: false, reason: 'global-disabled' };
      const cfg = opts.guildConfig(req.guildId);
      if (!cfg.enabled) return { ok: false, reason: 'guild-disabled' };
      if (!cfg.channelIds.includes(req.channelId)) return { ok: false, reason: 'not-allowed' };

      const start = throttle.tryStart(req.channelId, cfg.cooldownMs);
      if (start === 'cooldown') return { ok: false, reason: 'cooldown' };
      if (start === 'in-flight') return { ok: false, reason: 'in-flight' };
      if (start === 'rate-cap') return { ok: false, reason: 'rate-cap' };

      const sysPrompt = resolveSystemPrompt(req.guildId);
      const prompt = buildPrompt({
        systemPrompt: sysPrompt,
        channelMeta: req.channelMeta,
        history: req.history,
        target: req.target,
      });

      let session: AutonomySession;
      try {
        session = await opts.host.startSession({ cwd: opts.cwd });
      } catch (e) {
        throttle.finish(req.channelId);
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, reason: 'host-error', message: msg };
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
        throttle.finish(req.channelId);
        try { await session.close(); } catch { /* ignore */ }
      }
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
