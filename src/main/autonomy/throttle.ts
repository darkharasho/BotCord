export type ThrottleResult = 'ok' | 'cooldown' | 'in-flight' | 'rate-cap';

export interface Throttle {
  tryStart(channelId: string, cooldownMs: number): ThrottleResult;
  finish(channelId: string): void;
  abortAll(): void;
}

export function createThrottle(opts: { rateCapPerMin: (() => number) | number; now?: () => number }): Throttle {
  const now = opts.now ?? (() => Date.now());
  const rateCapValue = opts.rateCapPerMin;
  const rateCap = typeof rateCapValue === 'function' ? rateCapValue : () => rateCapValue;

  const lastFiredAt = new Map<string, number>();
  const inFlight = new Set<string>();
  const recentStartTimes: number[] = [];

  return {
    tryStart(channelId, cooldownMs) {
      const t = now();
      const last = lastFiredAt.get(channelId);
      if (last !== undefined && t - last < cooldownMs) return 'cooldown';
      if (inFlight.has(channelId)) return 'in-flight';

      while (recentStartTimes.length > 0 && t - recentStartTimes[0]! >= 60_000) {
        recentStartTimes.shift();
      }
      if (recentStartTimes.length >= rateCap()) return 'rate-cap';

      recentStartTimes.push(t);
      lastFiredAt.set(channelId, t);
      inFlight.add(channelId);
      return 'ok';
    },
    finish(channelId) {
      inFlight.delete(channelId);
    },
    abortAll() {
      inFlight.clear();
    },
  };
}
