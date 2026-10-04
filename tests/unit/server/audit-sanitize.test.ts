import { describe, expect, it } from "vitest";
import {
  clip,
  DETAILS_JSON_MAX_BYTES,
  isSecretField,
  sanitizeDetails,
  summarizeInput,
  summarizeRefusal,
} from "../../../apps/server/src/services/audit/sanitize";

// What may go into an audit event's details (services/audit/sanitize.ts):
// secret-looking fields never, long texts and lists shortened, the whole
// object below the size the table allows - deterministically; failures show
// only known input fields and a refusal's facts without content.

describe("secret fields", () => {
  it("are recognised by name, while ids, counts and prefixes stay", () => {
    for (const name of [
      "password",
      "newPassword",
      "token",
      "tokens",
      "secret",
      "totpSecret",
      "code",
      "codes",
      "recoveryCodes",
      "recovery_code",
      "tokenHash",
      "setupToken",
      "setup_token",
      "authorization",
      "cookie",
      "challenge",
      "publicKey",
      "email",
      "body",
      "text",
      "response",
      "metadata",
    ]) {
      expect(isSecretField(name), name).toBe(true);
    }
    for (const name of [
      "tokenId",
      "recoveryCodeCount",
      "tokenPrefix",
      "bodyCharacters",
      "noteId",
      "name",
      "path",
      "query",
    ]) {
      expect(isSecretField(name), name).toBe(false);
    }
  });

  it("are dropped at any depth, also inside lists", () => {
    const details = sanitizeDetails({
      password: "hunter2",
      nested: { token: "hmk_x", keep: 1, deeper: { secret: "s", ok: true } },
      list: [{ code: "123456", name: "key" }],
      body: "the whole note",
    });
    expect(details).toEqual({ list: [{ name: "key" }], nested: { deeper: { ok: true }, keep: 1 } });
    expect(JSON.stringify(details)).not.toMatch(/hunter2|hmk_x|123456|whole note/);
  });
});

describe("sizes", () => {
  it("shortens long texts by code points, never cutting an emoji", () => {
    expect(clip("abc", 5)).toBe("abc");
    expect(clip("🚀🚀🚀🚀🚀🚀", 4)).toBe("🚀🚀🚀…");
    const details = sanitizeDetails({ label: "x".repeat(1000) });
    expect(Array.from(details.label as string)).toHaveLength(300);
  });

  it("keeps the first 50 items of a list and says how many more there were", () => {
    const details = sanitizeDetails({ ids: Array.from({ length: 60 }, (_, i) => i) });
    expect(details.ids).toHaveLength(51);
    expect((details.ids as unknown[]).at(-1)).toBe("+10");
  });

  it("drops the largest fields first until the details fit, and names them", () => {
    const big = Object.fromEntries(
      Array.from({ length: 80 }, (_, i) => [`f${String(i).padStart(2, "0")}`, "y".repeat(290)]),
    );
    const first = sanitizeDetails({ ...big, small: 1 });
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(DETAILS_JSON_MAX_BYTES);
    expect(first.small).toBe(1);
    expect((first.omitted as string[]).length).toBeGreaterThan(0);
    // The same input gives the same result.
    expect(sanitizeDetails({ small: 1, ...big })).toEqual(first);
  });

  it("turns values JSON cannot hold into something it can", () => {
    expect(
      sanitizeDetails({ when: new Date("2026-10-04T00:00:00Z"), n: Number.NaN, f: () => 1 }),
    ).toEqual({ when: "2026-10-04T00:00:00.000Z", n: null });
  });
});

describe("summaries of failures", () => {
  it("keep known input fields only, a body as its length and a query shortened", () => {
    expect(
      summarizeInput({
        note: { address: "Projects/Plan" },
        expected_version: 3,
        body: "secret 🚀 text",
        password: "pw",
        query: "q".repeat(250),
        unknown: "dropped",
        reason: "goes to its own column",
      }),
    ).toEqual({
      note: "Projects/Plan",
      expected_version: 3,
      bodyCharacters: 13,
      query: `${"q".repeat(199)}…`,
    });
    expect(summarizeInput({ note: { id: "abc" } })).toEqual({ note: "abc" });
    expect(summarizeInput("not an object")).toEqual({});
  });

  it("keep a refusal's facts and field codes, never a section's text or a rule", () => {
    expect(
      summarizeRefusal({
        currentVersion: 4,
        currentSection: { path: "Setup", text: "the section text" },
        updatedBy: "ada",
        fields: {
          body: { code: "too_long", rule: "body must be at most 1 MB" },
          title: { code: "Bad Code" },
        },
      }),
    ).toEqual({ currentVersion: 4, fields: [{ field: "body", error: "too_long" }] });
  });
});
