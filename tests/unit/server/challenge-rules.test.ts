import { describe, expect, it } from "vitest";
import {
  isRecentlyReauthenticated,
  reauthenticatedUntil,
} from "../../../apps/server/src/services/sessions/reauthentication";
import {
  afterWrongAnswer,
  type ChallengeState,
  challengeExpiry,
  isChallengeUsable,
} from "../../../apps/server/src/services/two-factor/challenge-rules";

// When a sign-in challenge may be used, what wrong answers do to it, and the
// window of a re-entered password. Pure rules, checked with fixed times.

const now = new Date("2026-10-03T12:00:00Z");
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

const usable: ChallengeState = {
  purpose: "second_factor",
  expiresAt: minutes(1),
  usedAt: null,
  attempts: 0,
};

describe("isChallengeUsable", () => {
  it("accepts an open challenge of an accepted purpose", () => {
    expect(isChallengeUsable(usable, ["second_factor"], now)).toBe(true);
  });

  it.each([
    ["another purpose", { purpose: "setup_enrolment" as const }],
    ["used", { usedAt: minutes(-1) }],
    ["expired exactly now", { expiresAt: now }],
    ["expired", { expiresAt: minutes(-1) }],
    ["out of attempts", { attempts: 5 }],
  ])("refuses a challenge that is %s", (_, change) => {
    expect(isChallengeUsable({ ...usable, ...change }, ["second_factor"], now)).toBe(false);
  });

  it("accepts the fifth answer but not a sixth", () => {
    expect(isChallengeUsable({ ...usable, attempts: 4 }, ["second_factor"], now)).toBe(true);
  });
});

describe("afterWrongAnswer", () => {
  it("counts down to a burnt challenge after 5 wrong answers", () => {
    const steps = [0, 1, 2, 3, 4].map(afterWrongAnswer);
    expect(steps.map((step) => step.remaining)).toEqual([4, 3, 2, 1, 0]);
    expect(steps.map((step) => step.burnt)).toEqual([false, false, false, false, true]);
    expect(afterWrongAnswer(5)).toEqual({ attempts: 5, remaining: 0, burnt: true });
  });
});

describe("challengeExpiry", () => {
  it("gives each purpose its lifetime", () => {
    expect(challengeExpiry("second_factor", now)).toEqual(minutes(5));
    expect(challengeExpiry("enrolment", now)).toEqual(minutes(15));
    expect(challengeExpiry("setup_enrolment", now)).toEqual(minutes(15));
    expect(challengeExpiry("webauthn_authentication", now)).toEqual(minutes(5));
  });

  it("never lets a ceremony outlive its sign-in challenge", () => {
    expect(challengeExpiry("webauthn_authentication", now, minutes(2))).toEqual(minutes(2));
    expect(challengeExpiry("webauthn_authentication", now, minutes(9))).toEqual(minutes(5));
  });
});

describe("re-entered password", () => {
  it("counts for 10 minutes", () => {
    expect(isRecentlyReauthenticated(null, now)).toBe(false);
    expect(isRecentlyReauthenticated(minutes(-9.9), now)).toBe(true);
    expect(isRecentlyReauthenticated(minutes(-10), now)).toBe(false);
    // A time in the future (clock skew, tampering) does not count.
    expect(isRecentlyReauthenticated(minutes(1), now)).toBe(false);
    expect(reauthenticatedUntil(now)).toEqual(minutes(10));
  });
});
