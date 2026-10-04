import { TRASH_RETENTION_DAYS } from "@hexmark/shared";
import { describe, expect, it } from "vitest";
import { readTrashRetention } from "../../../apps/server/src/config/trash";
import { isDue, purgeAt, purgeCutoff } from "../../../apps/server/src/services/trash/retention";

// The trash's retention: the setting (TRASH_RETENTION_DAYS) and when an item
// is due for the purge.

const DAY = 24 * 60 * 60 * 1000;

describe("TRASH_RETENTION_DAYS", () => {
  it("defaults to 28 days", () => {
    expect(TRASH_RETENTION_DAYS.default).toBe(28);
    expect(readTrashRetention({})).toEqual({ days: 28, problem: null });
    expect(readTrashRetention({ TRASH_RETENTION_DAYS: "  " })).toEqual({ days: 28, problem: null });
  });

  it("accepts whole numbers from 1 to 3650", () => {
    expect(readTrashRetention({ TRASH_RETENTION_DAYS: "1" })).toEqual({ days: 1, problem: null });
    expect(readTrashRetention({ TRASH_RETENTION_DAYS: " 90 " })).toEqual({
      days: 90,
      problem: null,
    });
    expect(readTrashRetention({ TRASH_RETENTION_DAYS: "3650" }).days).toBe(3650);
  });

  it("falls back to the default with a problem for anything else", () => {
    for (const raw of ["0", "3651", "-5", "7.5", "1e2", "two weeks", "28d"]) {
      const read = readTrashRetention({ TRASH_RETENTION_DAYS: raw });
      expect(read.days).toBe(28);
      expect(read.problem).toBe(
        "TRASH_RETENTION_DAYS must be a whole number between 1 and 3650; using the default 28.",
      );
    }
  });
});

describe("retention", () => {
  const deletedAt = new Date("2026-03-01T10:15:00.000Z");

  it("purges after exactly the retention: on day 29 with 28 days", () => {
    expect(purgeAt(deletedAt, 28).toISOString()).toBe("2026-03-29T10:15:00.000Z");
    // Day 28 after deletion, a millisecond before the end of the retention.
    expect(isDue(deletedAt, new Date(deletedAt.getTime() + 28 * DAY - 1), 28)).toBe(false);
    // The moment the retention ends (the 29th day begins) and later.
    expect(isDue(deletedAt, new Date(deletedAt.getTime() + 28 * DAY), 28)).toBe(true);
    expect(isDue(deletedAt, new Date(deletedAt.getTime() + 40 * DAY), 28)).toBe(true);
    // Never before it was deleted.
    expect(isDue(deletedAt, deletedAt, 28)).toBe(false);
  });

  it("counts days of 24 hours, also across a daylight saving change", () => {
    // Europe moves its clocks on 2026-03-29; timestamps are UTC.
    expect(purgeAt(new Date("2026-03-28T23:30:00Z"), 1).toISOString()).toBe(
      "2026-03-29T23:30:00.000Z",
    );
  });

  it("selects by cutoff exactly what isDue says (deleted_at <= now - retention)", () => {
    const now = new Date("2026-10-03T12:00:00.000Z");
    for (const days of [1, 28, 3650]) {
      const cutoff = purgeCutoff(now, days);
      for (const offset of [-DAY, -1, 0, 1, DAY]) {
        const deleted = new Date(cutoff.getTime() + offset);
        expect(deleted.getTime() <= cutoff.getTime()).toBe(isDue(deleted, now, days));
      }
    }
  });
});
