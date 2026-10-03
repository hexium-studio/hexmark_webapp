import { describe, expect, it } from "vitest";
import { SETUP_RATE_LIMIT } from "../../../apps/server/src/config/rate-limits";
import { AttemptLimiter } from "../../../apps/server/src/lib/rate-limiter";

// The sliding-window limiter behind the setup token attempts. Time is passed
// in explicitly, so nothing here waits.

const WINDOW = 60_000;

describe("AttemptLimiter", () => {
  it("allows `max` attempts per key within the window, then blocks", () => {
    const limiter = new AttemptLimiter({ max: 3, windowMs: WINDOW });
    expect([1, 2, 3, 4].map(() => limiter.tryAcquire("a", 1_000))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("counts every key on its own", () => {
    const limiter = new AttemptLimiter({ max: 1, windowMs: WINDOW });
    expect(limiter.tryAcquire("a", 0)).toBe(true);
    expect(limiter.tryAcquire("b", 0)).toBe(true);
    expect(limiter.tryAcquire("a", 0)).toBe(false);
  });

  it("frees an attempt once it is older than the window (sliding)", () => {
    const limiter = new AttemptLimiter({ max: 2, windowMs: WINDOW });
    limiter.tryAcquire("a", 0);
    limiter.tryAcquire("a", 30_000);
    expect(limiter.tryAcquire("a", WINDOW)).toBe(true);
    expect(limiter.tryAcquire("a", WINDOW)).toBe(false);
    expect(limiter.tryAcquire("a", WINDOW + 30_000)).toBe(true);
  });

  it("does not count blocked attempts", () => {
    const limiter = new AttemptLimiter({ max: 1, windowMs: WINDOW });
    limiter.tryAcquire("a", 0);
    for (let t = 1; t < 10; t += 1) expect(limiter.tryAcquire("a", t * 1_000)).toBe(false);
    expect(limiter.tryAcquire("a", WINDOW + 1)).toBe(true);
  });

  it("takes back the latest attempt on release", () => {
    const limiter = new AttemptLimiter({ max: 2, windowMs: WINDOW });
    limiter.tryAcquire("a", 0);
    limiter.tryAcquire("a", 0);
    limiter.release("a");
    expect(limiter.tryAcquire("a", 0)).toBe(true);
    expect(limiter.tryAcquire("a", 0)).toBe(false);
    limiter.release("unknown");
  });

  it("keeps working with many distinct keys (expired ones are swept)", () => {
    const limiter = new AttemptLimiter({ max: 1, windowMs: WINDOW });
    for (let n = 0; n < 10_050; n += 1) limiter.tryAcquire(`old${n}`, 0);
    expect(limiter.tryAcquire("new", WINDOW + 1)).toBe(true);
    expect(limiter.tryAcquire("old1", WINDOW + 1)).toBe(true);
    expect(limiter.tryAcquire("new", WINDOW + 2)).toBe(false);
  });
});

describe("setup rate limit", () => {
  it("is 5 per address and 20 overall within 15 minutes", () => {
    expect(SETUP_RATE_LIMIT).toEqual({ perAddress: 5, global: 20, windowMinutes: 15 });
  });
});
