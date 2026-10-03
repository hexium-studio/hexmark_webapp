// In-memory sliding-window limiter for failed attempts. State lives in this
// process only and is lost on restart; callers decide whether that is
// acceptable. Limits are configured by the caller (src/config/rate-limits.ts).

export interface AttemptLimiterOptions {
  // Attempts allowed per key within the window.
  max: number;
  windowMs: number;
}

// Above this many tracked keys, expired keys are swept on the next write so
// many distinct addresses cannot grow the map without bound.
const SWEEP_THRESHOLD = 10_000;

export class AttemptLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly options: AttemptLimiterOptions) {}

  // Counts an attempt for `key` unless the limit is reached. Check and count
  // happen in one synchronous step, so concurrent requests cannot all pass
  // the check before any of them is counted. Returns false when blocked.
  tryAcquire(key: string, now = Date.now()): boolean {
    const recent = this.recent(key, now);
    if (recent.length >= this.options.max) return false;
    recent.push(now);
    this.attempts.set(key, recent);
    if (this.attempts.size > SWEEP_THRESHOLD) this.sweep(now);
    return true;
  }

  // Takes back the most recent attempt for `key`, for attempts that turned
  // out not to be failures.
  release(key: string): void {
    const list = this.attempts.get(key);
    if (!list) return;
    list.pop();
    if (list.length === 0) this.attempts.delete(key);
  }

  private recent(key: string, now: number): number[] {
    const cutoff = now - this.options.windowMs;
    return (this.attempts.get(key) ?? []).filter((time) => time > cutoff);
  }

  private sweep(now: number): void {
    for (const key of [...this.attempts.keys()]) {
      const recent = this.recent(key, now);
      if (recent.length === 0) this.attempts.delete(key);
      else this.attempts.set(key, recent);
    }
  }
}
