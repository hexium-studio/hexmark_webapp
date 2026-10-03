import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import {
  count,
  digest,
  insertUser,
  tryInsert,
  UNKNOWN_USER,
  violation,
} from "./two-factor-harness";

// The auth_challenges table (migration 0004): the rules the database enforces
// on its own, independent of the services using it.

const PURPOSES = [
  "second_factor",
  "enrolment",
  "setup_enrolment",
  "webauthn_registration",
  "webauthn_authentication",
];

let db: TestDatabase;
let userId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
});

const webauthnChallenge = () => randomBytes(32).toString("base64url");

function row(values: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: userId,
    token_hash: digest(),
    purpose: "second_factor",
    expires_at: new Date(Date.now() + 300_000),
    ...values,
  };
}

const attempt = (values: Record<string, unknown> = {}) =>
  tryInsert(db, "auth_challenges", row(values));

describe("auth_challenges", () => {
  it("accepts a complete row and fills the defaults", async () => {
    const [created] = await db.sql`insert into auth_challenges ${db.sql(row())} returning *`;
    expect(created).toMatchObject({
      remember: false,
      attempts: 0,
      used_at: null,
      webauthn_challenge: null,
    });
    expect(created?.created_at).toBeInstanceOf(Date);
    await db.sql`delete from auth_challenges`;
  });

  it.each(PURPOSES)("accepts the purpose %s", async (purpose) => {
    await expect(
      attempt({ purpose, webauthn_challenge: webauthnChallenge() }),
    ).resolves.toBeUndefined();
  });

  it.each(["login", "SECOND_FACTOR", "", "recovery"])("refuses the purpose %j", async (purpose) => {
    await expect(attempt({ purpose })).rejects.toMatchObject(violation.check);
  });

  it("requires a purpose", async () => {
    await expect(attempt({ purpose: null })).rejects.toMatchObject(violation.notNull);
  });

  it.each([
    ["the raw token (base64url)", randomBytes(32).toString("base64url")],
    ["upper-case hex", "A".repeat(64)],
    ["a short digest", "a".repeat(63)],
    ["an empty string", ""],
  ])("refuses %s as token_hash", async (_label, value) => {
    await expect(attempt({ token_hash: value })).rejects.toMatchObject(violation.check);
  });

  it("refuses a token_hash that is already in use", async () => {
    const hash = digest();
    await db.sql`insert into auth_challenges ${db.sql(row({ token_hash: hash }))}`;
    await expect(attempt({ token_hash: hash })).rejects.toMatchObject(violation.unique);
    await db.sql`delete from auth_challenges`;
  });

  it("requires the WebAuthn challenge for a WebAuthn ceremony only", async () => {
    for (const purpose of ["webauthn_registration", "webauthn_authentication"]) {
      await expect(attempt({ purpose })).rejects.toMatchObject(violation.check);
    }
    await expect(
      attempt({ purpose: "second_factor", webauthn_challenge: webauthnChallenge() }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["padding", "abcdefghijklmnop="],
    ["fewer than 16 characters", "abcdefghijklmno"],
    ["more than 255 characters", "a".repeat(256)],
  ])("refuses a WebAuthn challenge with %s", async (_label, value) => {
    await expect(attempt({ webauthn_challenge: value })).rejects.toMatchObject(violation.check);
  });

  it("refuses a negative attempt count", async () => {
    await expect(attempt({ attempts: 5 })).resolves.toBeUndefined();
    await expect(attempt({ attempts: -1 })).rejects.toMatchObject(violation.check);
  });

  it("refuses an end that is not after the start", async () => {
    const now = new Date();
    await expect(attempt({ created_at: now, expires_at: now })).rejects.toMatchObject(
      violation.check,
    );
    await expect(
      attempt({ created_at: now, expires_at: new Date(now.getTime() - 1000) }),
    ).rejects.toMatchObject(violation.check);
    await expect(attempt({ expires_at: null })).rejects.toMatchObject(violation.notNull);
  });

  it("refuses a challenge of an unknown user", async () => {
    await expect(attempt({ user_id: UNKNOWN_USER })).rejects.toMatchObject(violation.foreignKey);
  });

  it("deletes a user's challenges with the user and keeps everyone else's", async () => {
    const leaving = await insertUser(db, "leaving");
    const staying = await insertUser(db, "staying");
    await db.sql`insert into auth_challenges ${db.sql([row({ user_id: leaving }), row({ user_id: leaving, purpose: "enrolment" }), row({ user_id: staying })])}`;
    const kept = await db.sql`select * from auth_challenges where user_id = ${staying}`;

    await db.sql`delete from users where id = ${leaving}`;

    expect(await count(db, "auth_challenges", leaving)).toBe(0);
    expect(await db.sql`select * from auth_challenges where user_id = ${staying}`).toEqual(kept);
  });

  it("has indexes for lookups by user and for removing expired rows", async () => {
    const indexes = await db.sql`
      select indexname, indexdef from pg_indexes where tablename = 'auth_challenges' order by indexname
    `;
    const definitions = indexes.map((index) => index.indexdef as string);
    expect(definitions.some((d) => d.includes("(user_id)"))).toBe(true);
    expect(definitions.some((d) => d.includes("(expires_at)"))).toBe(true);
    expect(definitions.some((d) => d.includes("UNIQUE") && d.includes("(token_hash)"))).toBe(true);
  });
});
