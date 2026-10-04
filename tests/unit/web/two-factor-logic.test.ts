import { describe, expect, it } from "vitest";
import { isRecentlyConfirmed } from "@/components/reauthentication/recent";
import { challengeCookieOptions, readChallengeToken } from "@/lib/challenge/cookie";
import {
  encodePendingSession,
  pendingSessionOptions,
  readPendingSession,
} from "@/lib/session/pending";
import { readFactorFailure, readRecoveryCodes } from "@/lib/two-factor/factor-result";
import { groupManualKey } from "@/lib/two-factor/manual-key";
import { readAccountSecurity } from "@/lib/two-factor/overview";
import { browserWebauthnError } from "@/lib/two-factor/webauthn-errors";

// Pure parts of the second-factor pages: the challenge cookie, the session
// held during forced enrolment, how refusals and overviews are read, the
// manual key, browser WebAuthn errors and the 10-minute confirmation.

const NOW = new Date("2026-10-03T12:00:00.000Z");
const TOKEN = "a".repeat(43);

describe("challenge cookie", () => {
  it("is httpOnly and lives exactly until the challenge expires", () => {
    expect(challengeCookieOptions("2026-10-03T12:05:00.000Z", false, NOW)).toEqual({
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 300,
    });
    expect(challengeCookieOptions("2026-10-03T11:00:00.000Z", true, NOW)).toMatchObject({
      secure: true,
      maxAge: 0,
    });
  });

  it("accepts only well-formed tokens", () => {
    expect(readChallengeToken(TOKEN)).toBe(TOKEN);
    expect(readChallengeToken(`${TOKEN}=`)).toBeUndefined();
    expect(readChallengeToken("")).toBeUndefined();
    expect(readChallengeToken(undefined)).toBeUndefined();
  });
});

describe("held session (forced enrolment)", () => {
  const signedIn = {
    session: { token: TOKEN, expiresAt: "2026-10-31T12:00:00.000Z", remember: true },
    locale: "de",
  };

  it("round-trips through its cookie value", () => {
    expect(readPendingSession(encodePendingSession(signedIn))).toEqual(signedIn);
    const { locale: _, ...withoutLocale } = signedIn;
    expect(readPendingSession(encodePendingSession(withoutLocale))).toEqual(withoutLocale);
  });

  it("refuses forged or broken values", () => {
    const forged = Buffer.from(JSON.stringify({ ...signedIn.session, token: "x" })).toString(
      "base64url",
    );
    expect(readPendingSession(forged)).toBeUndefined();
    expect(readPendingSession("not json")).toBeUndefined();
    expect(readPendingSession(undefined)).toBeUndefined();
  });

  it("is httpOnly and short-lived, never past the session's end", () => {
    const { options } = pendingSessionOptions(signedIn, false, NOW);
    expect(options).toEqual({
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 900,
    });
    const ending = {
      ...signedIn,
      session: { ...signedIn.session, expiresAt: "2026-10-03T12:01:00.000Z" },
    };
    expect(pendingSessionOptions(ending, true, NOW).options.maxAge).toBe(60);
  });
});

describe("readFactorFailure", () => {
  const answer = (status: number, body: unknown) =>
    readFactorFailure({ reachable: true, status, body });

  it("keeps known codes and the attempts left", () => {
    expect(answer(401, { error: "invalid_code", attemptsRemaining: 3 })).toEqual({
      ok: false,
      error: "invalid_code",
      attemptsRemaining: 3,
      fields: {},
    });
    expect(answer(401, { error: "challenge_invalid" })).toEqual({
      ok: false,
      error: "challenge_invalid",
      fields: {},
    });
  });

  it("drops what it does not know", () => {
    expect(answer(500, { error: "internal" })).toMatchObject({ error: "unexpected" });
    expect(answer(401, { error: "invalid_code", attemptsRemaining: -1 })).not.toHaveProperty(
      "attemptsRemaining",
    );
    expect(readFactorFailure({ reachable: false })).toMatchObject({ error: "server_unreachable" });
    expect(answer(400, { error: "validation", fields: { name: { code: "too_long" } } })).toEqual({
      ok: false,
      error: "validation",
      fields: { name: { code: "too_long" } },
    });
  });

  it("reads recovery code lists, null, and nothing else", () => {
    expect(readRecoveryCodes(["ABCD-EFGH-JKLM"])).toEqual(["ABCD-EFGH-JKLM"]);
    expect(readRecoveryCodes(null)).toBeNull();
    expect(readRecoveryCodes([1])).toBeUndefined();
    expect(readRecoveryCodes(undefined)).toBeUndefined();
  });
});

describe("readAccountSecurity", () => {
  const body = {
    totp: { enabled: true },
    webauthn: {
      available: true,
      credentials: [
        {
          id: "k1",
          name: "YubiKey",
          createdAt: "2026-10-01T08:00:00.000Z",
          lastUsedAt: null,
          deviceType: "crossPlatform",
          backedUp: false,
        },
      ],
    },
    recoveryCodes: { remaining: 9 },
    requireTwoFactor: false,
    reauthenticatedUntil: null,
    timezone: "Europe/Berlin",
  };

  it("checks every field and normalises unknown device types", () => {
    expect(readAccountSecurity(body)).toEqual({
      ...body,
      webauthn: {
        available: true,
        credentials: [{ ...body.webauthn.credentials[0], deviceType: null }],
      },
    });
  });

  it("falls back to UTC and refuses broken lists", () => {
    expect(readAccountSecurity({ ...body, timezone: "" })?.timezone).toBe("UTC");
    expect(
      readAccountSecurity({ ...body, webauthn: { available: true, credentials: [{ id: 1 }] } }),
    ).toBeUndefined();
    expect(readAccountSecurity({ ...body, recoveryCodes: {} })).toBeUndefined();
  });
});

describe("helpers", () => {
  it("groups the manual key in fours", () => {
    expect(groupManualKey("jbswy3dpehpk3pxp jbsw")).toEqual([
      "JBSW",
      "Y3DP",
      "EHPK",
      "3PXP",
      "JBSW",
    ]);
    expect(groupManualKey("ABCDEF")).toEqual(["ABCD", "EF"]);
  });

  it("maps the browser's WebAuthn errors", () => {
    expect(browserWebauthnError({ name: "NotAllowedError" })).toBe("webauthn_cancelled");
    expect(browserWebauthnError({ code: "ERROR_CEREMONY_ABORTED" })).toBe("webauthn_cancelled");
    expect(browserWebauthnError({ code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" })).toBe(
      "credential_exists",
    );
    expect(browserWebauthnError(new Error("boom"))).toBe("webauthn_browser_failed");
  });

  it("trusts a password confirmation until a few seconds before it ends", () => {
    const now = NOW.getTime();
    expect(isRecentlyConfirmed("2026-10-03T12:05:00.000Z", now)).toBe(true);
    expect(isRecentlyConfirmed("2026-10-03T12:00:03.000Z", now)).toBe(false);
    expect(isRecentlyConfirmed(null, now)).toBe(false);
    expect(isRecentlyConfirmed("later", now)).toBe(false);
  });
});
