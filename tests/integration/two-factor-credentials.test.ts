import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import {
  count,
  digest,
  insertUser,
  sealed,
  tryInsert,
  UNKNOWN_USER,
  violation,
} from "./two-factor-harness";

// totp_credentials, webauthn_credentials and recovery_codes (migration 0004):
// the rules the database enforces on its own, and that deleting a user takes
// their factors along and nobody else's.

let db: TestDatabase;
let userId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
});

const totp = (values: Record<string, unknown> = {}) => ({
  user_id: userId,
  secret_encrypted: sealed(),
  ...values,
});
const key = (values: Record<string, unknown> = {}) => ({
  user_id: userId,
  credential_id: randomBytes(32).toString("base64url"),
  public_key: randomBytes(77),
  name: "YubiKey",
  ...values,
});
const code = (values: Record<string, unknown> = {}) => ({
  user_id: userId,
  code_hash: digest(),
  ...values,
});

describe("totp_credentials", () => {
  it("accepts a pending credential with empty confirmation and step", async () => {
    const [row] = await db.sql`insert into totp_credentials ${db.sql(totp())} returning *`;
    expect(row).toMatchObject({ confirmed_at: null, last_used_step: null });
    expect(row?.created_at).toBeInstanceOf(Date);
    await db.sql`delete from totp_credentials`;
  });

  it("allows one credential per user", async () => {
    await db.sql`insert into totp_credentials ${db.sql(totp())}`;
    await expect(tryInsert(db, "totp_credentials", totp())).rejects.toMatchObject(violation.unique);
    await db.sql`delete from totp_credentials`;
  });

  it.each([
    ["a plain base32 secret", "JBSWY3DPEHPK3PXP"],
    ["a value without key id", "v1.abc"],
    ["an empty string", ""],
  ])("refuses %s as the encrypted secret", async (_label, value) => {
    await expect(
      tryInsert(db, "totp_credentials", totp({ secret_encrypted: value })),
    ).rejects.toMatchObject(violation.check);
  });

  it("keeps the last used step at zero or above, beyond 32 bits", async () => {
    await expect(
      tryInsert(db, "totp_credentials", totp({ last_used_step: 2 ** 40 })),
    ).resolves.toBeUndefined();
    await expect(
      tryInsert(db, "totp_credentials", totp({ last_used_step: -1 })),
    ).rejects.toMatchObject(violation.check);
  });
});

describe("webauthn_credentials", () => {
  it("accepts a key with defaults and keeps the public key bytes", async () => {
    const publicKey = randomBytes(77);
    const [row] = await db.sql`
      insert into webauthn_credentials ${db.sql(key({ public_key: publicKey, transports: db.sql.array(["usb", "nfc"]) }))}
      returning *
    `;
    expect(row).toMatchObject({ counter: "0", backed_up: false, aaguid: null, device_type: null });
    expect(row?.transports).toEqual(["usb", "nfc"]);
    expect(Buffer.compare(row?.public_key as Buffer, publicKey)).toBe(0);
    await db.sql`delete from webauthn_credentials`;
  });

  it("refuses a credential id that is already registered", async () => {
    const credentialId = randomBytes(16).toString("base64url");
    await db.sql`insert into webauthn_credentials ${db.sql(key({ credential_id: credentialId }))}`;
    const other = await insertUser(db, "other");
    await expect(
      tryInsert(db, "webauthn_credentials", key({ user_id: other, credential_id: credentialId })),
    ).rejects.toMatchObject(violation.unique);
    await db.sql`delete from webauthn_credentials`;
  });

  it.each([
    ["padding", "abc="],
    ["standard base64", "ab+/"],
    ["empty", ""],
    ["too long", "a".repeat(1365)],
  ])("refuses a credential id with %s", async (_label, value) => {
    await expect(
      tryInsert(db, "webauthn_credentials", key({ credential_id: value })),
    ).rejects.toMatchObject(violation.check);
  });

  it("accepts names of 1 to 64 characters only", async () => {
    for (const name of ["K", "ü".repeat(64)]) {
      await expect(tryInsert(db, "webauthn_credentials", key({ name }))).resolves.toBeUndefined();
    }
    for (const name of ["", "x".repeat(65)]) {
      await expect(tryInsert(db, "webauthn_credentials", key({ name }))).rejects.toMatchObject(
        violation.check,
      );
    }
  });

  it("checks counter and device type", async () => {
    await expect(tryInsert(db, "webauthn_credentials", key({ counter: -1 }))).rejects.toMatchObject(
      violation.check,
    );
    for (const deviceType of ["singleDevice", "multiDevice"]) {
      await expect(
        tryInsert(db, "webauthn_credentials", key({ device_type: deviceType })),
      ).resolves.toBeUndefined();
    }
    await expect(
      tryInsert(db, "webauthn_credentials", key({ device_type: "platform" })),
    ).rejects.toMatchObject(violation.check);
  });
});

describe("recovery_codes", () => {
  it("refuses the same digest twice for one user, not across users", async () => {
    const hash = digest();
    await db.sql`insert into recovery_codes ${db.sql(code({ code_hash: hash }))}`;
    await expect(tryInsert(db, "recovery_codes", code({ code_hash: hash }))).rejects.toMatchObject(
      violation.unique,
    );
    const other = await insertUser(db, "another");
    await expect(
      tryInsert(db, "recovery_codes", code({ user_id: other, code_hash: hash })),
    ).resolves.toBeUndefined();
    await db.sql`delete from recovery_codes`;
  });

  it.each([
    ["a plain code", "ABCD-EFGH-JKLM"],
    ["upper-case hex", "A".repeat(64)],
    ["a short digest", "a".repeat(63)],
  ])("refuses %s as code_hash", async (_label, value) => {
    await expect(tryInsert(db, "recovery_codes", code({ code_hash: value }))).rejects.toMatchObject(
      violation.check,
    );
  });
});

describe("factors and users", () => {
  it.each([
    ["totp_credentials", totp],
    ["webauthn_credentials", key],
    ["recovery_codes", code],
  ] as const)("refuses %s of an unknown user", async (table, row) => {
    await expect(tryInsert(db, table, row({ user_id: UNKNOWN_USER }))).rejects.toMatchObject(
      violation.foreignKey,
    );
  });

  it("deletes a user's factors with the user and keeps everyone else's", async () => {
    const leaving = await insertUser(db, "leaving");
    const staying = await insertUser(db, "staying");
    for (const id of [leaving, staying]) {
      await db.sql`insert into totp_credentials ${db.sql(totp({ user_id: id }))}`;
      await db.sql`insert into webauthn_credentials ${db.sql([key({ user_id: id }), key({ user_id: id })])}`;
      await db.sql`insert into recovery_codes ${db.sql([code({ user_id: id }), code({ user_id: id })])}`;
    }
    const tables = ["totp_credentials", "webauthn_credentials", "recovery_codes"];
    const kept = await Promise.all(
      tables.map((table) => db.sql`select * from ${db.sql(table)} where user_id = ${staying}`),
    );

    await db.sql`delete from users where id = ${leaving}`;

    for (const table of tables) expect(await count(db, table, leaving)).toBe(0);
    const after = await Promise.all(
      tables.map((table) => db.sql`select * from ${db.sql(table)} where user_id = ${staying}`),
    );
    expect(after).toEqual(kept);
    expect(kept.map((rows) => rows.length)).toEqual([1, 2, 2]);
  });
});
