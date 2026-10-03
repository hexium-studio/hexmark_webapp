import { AttemptLimiter } from "./rate-limiter";

// Two limits on failed attempts at once: per source address and across all
// addresses. The global one caps attempts that come from many addresses, or
// from one shared address (e.g. a proxy) that all real users sit behind.

export interface AttemptGateOptions {
  perAddress: number;
  global: number;
  windowMs: number;
}

export interface ReservedAttempt {
  // The attempt was not a failure: stop counting it. Safe to call twice.
  release(): void;
}

const OVERALL_KEY = "*";

export class AttemptGate {
  private readonly perAddress: AttemptLimiter;
  private readonly overall: AttemptLimiter;

  constructor(options: AttemptGateOptions) {
    this.perAddress = new AttemptLimiter({ max: options.perAddress, windowMs: options.windowMs });
    this.overall = new AttemptLimiter({ max: options.global, windowMs: options.windowMs });
  }

  // Reserves an attempt before any work is done; null when a limit is
  // reached. A reserved attempt counts as failed unless released, so requests
  // running in parallel are counted from the start. Synchronous: call it
  // before the request's first await that could let another request in.
  reserve(address: string, now = Date.now()): ReservedAttempt | null {
    if (!this.perAddress.tryAcquire(address, now)) return null;
    if (!this.overall.tryAcquire(OVERALL_KEY, now)) {
      this.perAddress.release(address);
      return null;
    }
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.perAddress.release(address);
        this.overall.release(OVERALL_KEY);
      },
    };
  }
}
