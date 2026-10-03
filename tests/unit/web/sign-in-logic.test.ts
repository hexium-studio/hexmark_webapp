import { describe, expect, it } from "vitest";
import { validateSignIn } from "@/app/_components/sign-in-form";
import { toLoginOutcome } from "@/app/_components/sign-in-result";

// The sign-in form's check (the shared schema) and how login answers map to
// what the form shows.

describe("validateSignIn", () => {
  it("accepts a valid e-mail and any non-empty password, normalising the e-mail", () => {
    expect(validateSignIn({ email: " Ada@Example.COM ", password: " x ", remember: true })).toEqual(
      { ok: true, input: { email: "ada@example.com", password: " x ", remember: true } },
    );
  });

  it("reports empty and malformed values per field", () => {
    expect(validateSignIn({ email: "", password: "", remember: false })).toEqual({
      ok: false,
      errors: { email: { code: "required" }, password: { code: "required" } },
    });
    expect(validateSignIn({ email: "ada@", password: "x", remember: false })).toEqual({
      ok: false,
      errors: { email: { code: "invalid_email" } },
    });
  });
});

describe("toLoginOutcome", () => {
  const session = { token: "t".repeat(43), expiresAt: "2026-10-31T12:00:00.000Z", remember: true };
  const challenge = { token: "c".repeat(43), expiresAt: "2026-10-03T12:05:00.000Z" };
  const signedIn = { ok: true, status: "signed_in" };
  const answer = (status: number, body: unknown) =>
    toLoginOutcome({ reachable: true, status, body });

  it("hands the issued session and the account's locale to the action", () => {
    expect(answer(200, { ...signedIn, user: { locale: "de" }, session })).toEqual({
      kind: "signed_in",
      session,
      locale: "de",
    });
    // Without a locale the session still counts; the cookie is just not set.
    expect(answer(200, { ...signedIn, user: {}, session })).toStrictEqual({
      kind: "signed_in",
      session,
    });
    expect(answer(200, { ...signedIn, user: { locale: 7 }, session })).toStrictEqual({
      kind: "signed_in",
      session,
    });
    expect(answer(200, { ...signedIn, session: { ...session, token: 1 } })).toMatchObject({
      result: { error: "unexpected" },
    });
    // A session without the "signed_in" status is not trusted.
    expect(answer(200, { ok: true, user: {}, session })).toMatchObject({
      result: { error: "unexpected" },
    });
  });

  it("continues with the second factor, keeping known methods only", () => {
    const body = {
      ok: false,
      status: "second_factor_required",
      challenge,
      methods: ["webauthn", "sms", "totp", "totp", "recovery"],
    };
    expect(answer(200, body)).toEqual({
      kind: "second_factor",
      challenge,
      methods: ["webauthn", "totp", "recovery"],
    });
    // No usable method: an empty list, which the page explains.
    expect(answer(200, { ...body, methods: [] })).toMatchObject({ methods: [] });
    expect(answer(200, { ...body, methods: "totp" })).toMatchObject({ methods: [] });
  });

  it("continues with forced enrolment; recovery codes are no method there", () => {
    const body = {
      ok: false,
      status: "enrolment_required",
      challenge,
      methods: ["totp", "recovery", "webauthn"],
    };
    expect(answer(200, body)).toEqual({
      kind: "enrolment",
      challenge,
      methods: ["totp", "webauthn"],
    });
  });

  it("treats an unknown status or a missing challenge as unexpected", () => {
    const failed = { kind: "failed", result: { ok: false, error: "unexpected", fields: {} } };
    expect(answer(200, { ok: false, status: "something_new", challenge, methods: [] })).toEqual(
      failed,
    );
    expect(answer(200, { ok: false, status: "second_factor_required", methods: [] })).toEqual(
      failed,
    );
    expect(
      answer(200, {
        ok: false,
        status: "enrolment_required",
        challenge: { token: 1, expiresAt: "x" },
        methods: [],
      }),
    ).toEqual(failed);
  });

  it.each([
    [401, "invalid_credentials", "invalid_credentials"],
    [429, "rate_limited", "rate_limited"],
    [403, "setup_token_present", "setup_token_present"],
    [503, "database_unavailable", "database_unavailable"],
    [500, "internal", "unexpected"],
    [413, "payload_too_large", "unexpected"],
  ])("%i %s → %s", (status, error, expected) => {
    expect(answer(status, { error })).toEqual({
      kind: "failed",
      result: { ok: false, error: expected, fields: {} },
    });
  });

  it("keeps field codes of a 400, and maps no answer to server_unreachable", () => {
    expect(
      answer(400, { error: "validation", fields: { email: { code: "invalid_email" } } }),
    ).toEqual({
      kind: "failed",
      result: { ok: false, error: "validation", fields: { email: { code: "invalid_email" } } },
    });
    expect(toLoginOutcome({ reachable: false })).toEqual({
      kind: "failed",
      result: { ok: false, error: "server_unreachable", fields: {} },
    });
  });
});
