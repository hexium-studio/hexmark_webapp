import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_DURATIONS,
  readSessionConfig,
} from "../../../apps/server/src/config/session";
import { formatDuration, parseDuration } from "../../../apps/server/src/lib/duration";

// Session lifetimes from the environment: the duration format, the bounds of
// each variable and the fallback to defaults. Nothing here reads process.env.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("parseDuration", () => {
  it.each([
    ["30s", 30_000],
    ["5m", 5 * MIN],
    ["1h", HOUR],
    ["28d", 28 * DAY],
    [" 12h ", 12 * HOUR],
    ["0m", 0],
  ])("reads %j", (raw, ms) => {
    expect(parseDuration(raw)).toBe(ms);
  });

  it.each(["", "5", "m", "5M", "1.5h", "-5m", "5 m", "5min", "1h30m", "1w", "9999999999d"])(
    "refuses %j",
    (raw) => {
      expect(parseDuration(raw)).toBeNull();
    },
  );

  it("formats milliseconds in the largest exact unit", () => {
    expect([28 * DAY, 36 * HOUR, 90 * MIN, 45_000].map(formatDuration)).toEqual([
      "28d",
      "36h",
      "90m",
      "45s",
    ]);
  });
});

describe("readSessionConfig", () => {
  it("uses 5m / 1h / 28d when nothing is set", () => {
    expect(readSessionConfig({})).toEqual({
      durations: { rotationMs: 5 * MIN, idleTimeoutMs: HOUR, maxAgeMs: 28 * DAY },
      problems: [],
    });
    expect(DEFAULT_SESSION_DURATIONS).toEqual(readSessionConfig({}).durations);
  });

  it("treats blank values as not set", () => {
    const result = readSessionConfig({ SESSION_ROTATION: "", SESSION_MAX_AGE: "  " });
    expect(result).toEqual({ durations: DEFAULT_SESSION_DURATIONS, problems: [] });
  });

  it("takes valid values", () => {
    const result = readSessionConfig({
      SESSION_ROTATION: "10m",
      SESSION_IDLE_TIMEOUT: "2h",
      SESSION_MAX_AGE: "7d",
    });
    expect(result).toEqual({
      durations: { rotationMs: 10 * MIN, idleTimeoutMs: 2 * HOUR, maxAgeMs: 7 * DAY },
      problems: [],
    });
  });

  it("accepts the bounds themselves", () => {
    const low = readSessionConfig({
      SESSION_ROTATION: "1m",
      SESSION_IDLE_TIMEOUT: "5m",
      SESSION_MAX_AGE: "1h",
    });
    expect(low.problems).toEqual([]);
    expect(low.durations).toEqual({ rotationMs: MIN, idleTimeoutMs: 5 * MIN, maxAgeMs: HOUR });
    const high = readSessionConfig({
      SESSION_ROTATION: "1h",
      SESSION_IDLE_TIMEOUT: "7d",
      SESSION_MAX_AGE: "365d",
    });
    expect(high.problems).toEqual([]);
    expect(high.durations).toEqual({
      rotationMs: HOUR,
      idleTimeoutMs: 7 * DAY,
      maxAgeMs: 365 * DAY,
    });
  });

  it.each([
    ["SESSION_ROTATION", "59s", "between 1m and 1h"],
    ["SESSION_ROTATION", "61m", "between 1m and 1h"],
    ["SESSION_IDLE_TIMEOUT", "4m", "between 5m and 7d"],
    ["SESSION_IDLE_TIMEOUT", "8d", "between 5m and 7d"],
    ["SESSION_MAX_AGE", "59m", "between 1h and 365d"],
    ["SESSION_MAX_AGE", "366d", "between 1h and 365d"],
    ["SESSION_MAX_AGE", "forever", "whole number followed by s, m, h or d"],
  ])("replaces %s=%s by its default and reports it", (variable, raw, hint) => {
    const result = readSessionConfig({ [variable]: raw });
    expect(result.durations).toEqual(DEFAULT_SESSION_DURATIONS);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain(variable);
    expect(result.problems[0]).toContain(hint);
    expect(result.problems[0]).toContain("using the default");
  });

  it("keeps the valid values when only one is out of bounds", () => {
    const result = readSessionConfig({ SESSION_ROTATION: "2m", SESSION_MAX_AGE: "1000d" });
    expect(result.durations).toEqual({ ...DEFAULT_SESSION_DURATIONS, rotationMs: 2 * MIN });
    expect(result.problems).toHaveLength(1);
  });

  it.each([
    ["rotation equal to the idle timeout", { SESSION_ROTATION: "1h", SESSION_IDLE_TIMEOUT: "1h" }],
    ["idle timeout above the maximum age", { SESSION_IDLE_TIMEOUT: "3d", SESSION_MAX_AGE: "2d" }],
    [
      "rotation above a short idle timeout",
      { SESSION_ROTATION: "30m", SESSION_IDLE_TIMEOUT: "10m" },
    ],
  ])("falls back to all defaults for %s", (_, source) => {
    const result = readSessionConfig(source);
    expect(result.durations).toEqual(DEFAULT_SESSION_DURATIONS);
    expect(result.problems).toEqual([expect.stringContaining("using the defaults for all three")]);
  });

  it("accepts an idle timeout equal to the maximum age", () => {
    const result = readSessionConfig({ SESSION_IDLE_TIMEOUT: "2d", SESSION_MAX_AGE: "2d" });
    expect(result.problems).toEqual([]);
    expect(result.durations.idleTimeoutMs).toBe(2 * DAY);
  });
});
