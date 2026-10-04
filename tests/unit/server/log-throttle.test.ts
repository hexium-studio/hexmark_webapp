import { describe, expect, it } from "vitest";
import { TOKEN_REJECTION_LOG } from "../../../apps/server/src/config/audit";
import { LogThrottle } from "../../../apps/server/src/lib/log-throttle";

// The throttle behind the log of rejected API tokens (lib/log-throttle.ts):
// once per key and window, the next one after the window with the number
// left out. Time is passed in, so nothing here waits.

const WINDOW = 10 * 60 * 1000;

describe("LogThrottle", () => {
  it("lets the first through, counts the rest of the window, reports them after it", () => {
    const throttle = new LogThrottle({ windowMs: WINDOW, maxKeys: 100 });
    expect(throttle.admit("a", 0)).toEqual({ log: true, suppressed: 0 });
    expect(throttle.admit("a", 1_000)).toEqual({ log: false });
    expect(throttle.admit("a", WINDOW - 1)).toEqual({ log: false });
    expect(throttle.admit("a", WINDOW)).toEqual({ log: true, suppressed: 2 });
    // A new window from there, and its count starts again.
    expect(throttle.admit("a", WINDOW + 5)).toEqual({ log: false });
    expect(throttle.admit("a", 3 * WINDOW)).toEqual({ log: true, suppressed: 1 });
    expect(throttle.admit("a", 5 * WINDOW)).toEqual({ log: true, suppressed: 0 });
  });

  it("keeps keys apart", () => {
    const throttle = new LogThrottle({ windowMs: WINDOW, maxKeys: 100 });
    expect(throttle.admit("a", 0).log).toBe(true);
    expect(throttle.admit("b", 1).log).toBe(true);
    expect(throttle.admit("a", 2).log).toBe(false);
    expect(throttle.admit("b", 3).log).toBe(false);
  });

  it("keeps at most maxKeys, dropping passed windows first, then the oldest", () => {
    const throttle = new LogThrottle({ windowMs: WINDOW, maxKeys: 3 });
    throttle.admit("old", 0);
    throttle.admit("b", WINDOW / 2);
    throttle.admit("c", WINDOW / 2 + 1);
    throttle.admit("d", WINDOW + 1);
    expect(throttle.size).toBe(3);
    // "old" was dropped: let through again at once.
    expect(throttle.admit("b", WINDOW + 2).log).toBe(false);
    throttle.admit("e", WINDOW + 3);
    throttle.admit("f", WINDOW + 4);
    expect(throttle.size).toBe(3);
    // The oldest ones went to make room.
    expect(throttle.admit("b", WINDOW + 5).log).toBe(true);
  });

  it("is configured for ten minutes per token value", () => {
    expect(TOKEN_REJECTION_LOG.windowMs).toBe(WINDOW);
    expect(TOKEN_REJECTION_LOG.maxKeys).toBeGreaterThanOrEqual(1_000);
  });
});
