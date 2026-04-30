import { describe, it, expect } from 'vitest';
import { createThrottle } from '../throttle';

describe('throttle', () => {
  it('allows the first request and blocks within cooldown', () => {
    let now = 1000;
    const t = createThrottle({ rateCapPerMin: 100, now: () => now });
    expect(t.tryStart('c1', 5000)).toBe('ok');
    now += 100;
    expect(t.tryStart('c1', 5000)).toBe('cooldown');
  });

  it('allows again after cooldown elapses', () => {
    let now = 1000;
    const t = createThrottle({ rateCapPerMin: 100, now: () => now });
    expect(t.tryStart('c1', 5000)).toBe('ok');
    t.finish('c1');
    now += 5001;
    expect(t.tryStart('c1', 5000)).toBe('ok');
  });

  it('blocks when in-flight on the same channel', () => {
    let now = 1000;
    const t = createThrottle({ rateCapPerMin: 100, now: () => now });
    expect(t.tryStart('c1', 0)).toBe('ok');
    expect(t.tryStart('c1', 0)).toBe('in-flight');
  });

  it('drops over the global rate cap inside one minute', () => {
    let now = 1000;
    const t = createThrottle({ rateCapPerMin: 2, now: () => now });
    expect(t.tryStart('c1', 0)).toBe('ok'); t.finish('c1');
    now += 1; expect(t.tryStart('c2', 0)).toBe('ok'); t.finish('c2');
    now += 1; expect(t.tryStart('c3', 0)).toBe('rate-cap');
  });

  it('refills the bucket as the window slides', () => {
    let now = 1000;
    const t = createThrottle({ rateCapPerMin: 1, now: () => now });
    expect(t.tryStart('c1', 0)).toBe('ok'); t.finish('c1');
    expect(t.tryStart('c2', 0)).toBe('rate-cap');
    now += 60_001;
    expect(t.tryStart('c2', 0)).toBe('ok');
  });
});
