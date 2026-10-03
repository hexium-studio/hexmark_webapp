import { describe, expect, it } from "vitest";
import {
  firstInvalidField,
  splitFieldErrors,
  validateAccount,
} from "@/app/setup/_components/account-form";
import { connectionChecks } from "@/app/setup/_components/connection-checks";
import { toSetupActionResult } from "@/app/setup/_components/setup-result";

// Pure parts of the setup wizard: client-side account validation, mapping
// API answers to wizard errors, and the connection checks of step 1.

const values = {
  displayName: "Ada",
  username: "ada",
  email: "ada@example.com",
  password: "correct horse battery",
  passwordConfirm: "correct horse battery",
};

describe("validateAccount", () => {
  it("accepts valid values with the token and locale of the wizard", () => {
    const result = validateAccount(values, "test2345", "de");
    expect(result).toMatchObject({ ok: true, input: { setupToken: "TEST2345", locale: "de" } });
  });

  it("keeps field errors apart from token or locale problems", () => {
    const result = validateAccount(
      { ...values, username: "x", passwordConfirm: "nope" },
      "bad",
      "de",
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        username: { code: "too_short", params: { min: 3 } },
        passwordConfirm: { code: "mismatch" },
      },
      other: { setupToken: { code: "invalid_format", params: { length: 8 } } },
    });
    if (!result.ok) expect(firstInvalidField(result.errors)).toBe("username");
  });

  it("splits API field errors into this form's fields and the rest", () => {
    expect(splitFieldErrors({ email: { code: "taken" }, body: { code: "invalid_body" } })).toEqual({
      errors: { email: { code: "taken" } },
      other: { body: { code: "invalid_body" } },
    });
  });
});

describe("toSetupActionResult", () => {
  it.each([
    [{ reachable: false } as const, { ok: false, error: "server_unreachable", fields: {} }],
    [{ reachable: true, status: 200, body: { ok: true } } as const, { ok: true }],
    [
      { reachable: true, status: 401, body: { error: "invalid_token" } } as const,
      { ok: false, error: "invalid_token", fields: {} },
    ],
    [
      { reachable: true, status: 404, body: { error: "not_found" } } as const,
      { ok: false, error: "setup_closed", fields: {} },
    ],
    [
      { reachable: true, status: 429, body: { error: "rate_limited" } } as const,
      { ok: false, error: "rate_limited", fields: {} },
    ],
    [
      { reachable: true, status: 500, body: null } as const,
      { ok: false, error: "unexpected", fields: {} },
    ],
    [
      {
        reachable: true,
        status: 400,
        body: {
          error: "validation",
          fields: {
            setupToken: { code: "invalid_format", params: { length: 8, x: {} } },
            bogus: { code: "nope" },
          },
        },
      } as const,
      {
        ok: false,
        error: "validation",
        fields: { setupToken: { code: "invalid_format", params: { length: 8 } } },
      },
    ],
  ])("%j", (response, expected) => {
    expect(toSetupActionResult(response, 200)).toEqual(expected);
  });
});

describe("connectionChecks", () => {
  const ok = {
    kind: "ok" as const,
    status: {
      setupOpen: true,
      setupTokenPresent: true,
      setupTokenConfigured: true,
      database: { reachable: true, migrated: true },
    },
  };
  const states = (status: Parameters<typeof connectionChecks>[0]) =>
    connectionChecks(status).map((check) => `${check.id}:${check.state}:${check.detail}`);

  it("passes everything when server, database and token are ready", () => {
    expect(states(ok)).toEqual([
      "server:pass:serverPass",
      "database:pass:databasePass",
      "token:pass:tokenPass",
    ]);
  });

  it("explains a missing or invalid token", () => {
    const missing = {
      ...ok,
      status: { ...ok.status, setupTokenPresent: false, setupTokenConfigured: false },
    };
    const invalid = { ...ok, status: { ...ok.status, setupTokenConfigured: false } };
    expect(states(missing)[2]).toBe("token:fail:tokenMissing");
    expect(states(invalid)[2]).toBe("token:fail:tokenInvalid");
  });

  it("does not check further when the server does not answer", () => {
    expect(states({ kind: "server_unreachable" })).toEqual([
      "server:fail:serverUnreachable",
      "database:unknown:notChecked",
      "token:unknown:notChecked",
    ]);
    expect(connectionChecks({ kind: "unexpected_response", httpStatus: 502 })[0]?.values).toEqual({
      status: "502",
    });
  });

  it("tells an unreachable database from one without tables", () => {
    const down = { kind: "database_unavailable" as const, setupTokenConfigured: true };
    expect(states({ ...down, database: { reachable: false, migrated: false } })[1]).toBe(
      "database:fail:databaseUnreachable",
    );
    expect(states({ ...down, database: { reachable: true, migrated: false } })[1]).toBe(
      "database:fail:databaseNotMigrated",
    );
    expect(
      states({
        ...down,
        setupTokenConfigured: false,
        database: { reachable: true, migrated: true },
      })[2],
    ).toBe("token:fail:tokenUnknown");
  });
});
