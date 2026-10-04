import { afterEach, describe, expect, it, vi } from "vitest";

// The application's UUID version 7 generator (RFC 9562): layout, time order
// and uniqueness, also when many ids fall into one millisecond and when the
// system clock goes backwards.

const FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// A fresh module per test, so the generator's last timestamp and counter do
// not carry over from another test.
async function generator() {
  vi.resetModules();
  return (await import("../../../apps/server/src/lib/uuid")).uuidv7;
}

function timestampOf(id: string): number {
  return Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
}

function counterOf(id: string): number {
  return Number.parseInt(id.replaceAll("-", "").slice(13, 16), 16);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("uuidv7", () => {
  it("has version 7, the RFC 9562 variant and the current time in milliseconds", async () => {
    const uuidv7 = await generator();
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    expect(id).toMatch(FORMAT);
    const bytes = id.replaceAll("-", "");
    expect(Number.parseInt(bytes[12] ?? "", 16)).toBe(7);
    expect(Number.parseInt(bytes[16] ?? "", 16) >> 2).toBe(0b10);
    expect(timestampOf(id)).toBeGreaterThanOrEqual(before);
    expect(timestampOf(id)).toBeLessThanOrEqual(after);
  });

  it("is strictly increasing across calls and never repeats", async () => {
    const uuidv7 = await generator();
    const ids = Array.from({ length: 20_000 }, () => uuidv7());
    for (const id of ids) expect(id).toMatch(FORMAT);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("counts up within one millisecond and carries over into the next", async () => {
    const uuidv7 = await generator();
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const ids = Array.from({ length: 5_000 }, () => uuidv7());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    const first = ids[0] ?? "";
    expect(timestampOf(first)).toBe(1_800_000_000_000);
    // The counter starts below 2048, so at least 2048 ids share the millisecond.
    expect(counterOf(first)).toBeLessThan(2048);
    expect(ids.slice(0, 2048).every((id) => timestampOf(id) === 1_800_000_000_000)).toBe(true);
    // 5000 ids need at most three counter runs of at least 2048.
    expect(timestampOf(ids.at(-1) ?? "")).toBeLessThanOrEqual(1_800_000_000_002);
  });

  it("keeps increasing when the clock goes backwards", async () => {
    const uuidv7 = await generator();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_500);
    const later = uuidv7();
    now.mockReturnValue(1_800_000_000_000);
    const earlierClock = uuidv7();
    expect(earlierClock > later).toBe(true);
    expect(timestampOf(earlierClock)).toBe(1_800_000_000_500);
  });

  it("takes its random part from the system's secure random source", async () => {
    const uuidv7 = await generator();
    const random = vi.spyOn(crypto, "getRandomValues");
    uuidv7();
    expect(random).toHaveBeenCalled();
  });
});
