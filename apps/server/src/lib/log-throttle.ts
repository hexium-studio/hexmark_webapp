// In-memory throttle for log entries that a client can cause again and
// again: per key, the first occurrence is let through and opens a window;
// further occurrences within the window are only counted. The first one
// after the window is let through again with that count, and opens the
// next window. State lives in this process only and is lost on restart.

export interface LogThrottleOptions {
  windowMs: number;
  // Most keys kept; beyond, keys whose window has passed are dropped first,
  // then the oldest ones.
  maxKeys: number;
}

export type ThrottleDecision = { log: true; suppressed: number } | { log: false };

interface KeyState {
  windowStart: number;
  suppressed: number;
}

export class LogThrottle {
  private readonly keys = new Map<string, KeyState>();

  constructor(private readonly options: LogThrottleOptions) {}

  // Decides and counts in one synchronous step, so concurrent requests
  // cannot both be let through for one key within a window.
  admit(key: string, now = Date.now()): ThrottleDecision {
    const state = this.keys.get(key);
    if (state && now - state.windowStart < this.options.windowMs) {
      state.suppressed += 1;
      return { log: false };
    }
    const suppressed = state?.suppressed ?? 0;
    // Re-inserted, so the map stays ordered by window start.
    this.keys.delete(key);
    this.keys.set(key, { windowStart: now, suppressed: 0 });
    if (this.keys.size > this.options.maxKeys) this.trim(now);
    return { log: true, suppressed };
  }

  get size(): number {
    return this.keys.size;
  }

  private trim(now: number): void {
    for (const [key, state] of this.keys) {
      if (now - state.windowStart >= this.options.windowMs) this.keys.delete(key);
    }
    for (const key of this.keys.keys()) {
      if (this.keys.size <= this.options.maxKeys) break;
      this.keys.delete(key);
    }
  }
}
