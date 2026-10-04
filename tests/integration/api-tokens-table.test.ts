import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { expectAccepted, expectRefused, insertToken, tokenRow, UNKNOWN_ID } from "./notes-harness";
import { insertUser } from "./two-factor-harness";

// The api_tokens table (migration 0005): the rules the database enforces on
// its own.

let db: TestDatabase;
let userId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
});

const token = (values: Record<string, unknown> = {}) => tokenRow(userId, values);
const ALL = ["read", "search", "create", "edit", "move", "delete", "lock"];

describe("api_tokens: columns", () => {
  it("accepts a token as the service writes it and leaves the optional columns empty", async () => {
    const [row] = await db.sql`insert into api_tokens ${db.sql(token())} returning *`;
    expect(row).toMatchObject({
      permissions: ["read", "search"],
      folder_scope: null,
      expires_at: null,
      last_used_at: null,
      revoked_at: null,
    });
    expect(row?.created_at).toBeInstanceOf(Date);
  });

  it("accepts names of 1 and 64 characters and every permission", async () => {
    await expectAccepted(db, "api_tokens", token({ name: "a" }));
    await expectAccepted(db, "api_tokens", token({ name: "x".repeat(64) }));
    await expectAccepted(db, "api_tokens", token({ permissions: ALL }));
    for (const permission of ALL) {
      await expectAccepted(db, "api_tokens", token({ permissions: [permission] }));
    }
  });

  it("refuses an empty or too long name", async () => {
    for (const name of ["", "x".repeat(65)]) {
      await expectRefused(db, "api_tokens", token({ name }), "api_tokens_name_length_check");
    }
  });

  it("refuses a hash that is not lower-case SHA-256 hex, and a raw token", async () => {
    const check = "api_tokens_token_hash_format_check";
    const hex = "a".repeat(64);
    for (const hash of [hex.toUpperCase(), "a".repeat(63), `${hex}0`, `hmk_${"A".repeat(43)}`]) {
      await expectRefused(db, "api_tokens", token({ token_hash: hash }), check);
    }
  });

  it("refuses a prefix that is not 'hmk_' and four base64url characters", async () => {
    const check = "api_tokens_token_prefix_format_check";
    await expectAccepted(db, "api_tokens", token({ token_prefix: "hmk_a-Z_" }));
    for (const prefix of ["hmk_abc", "hmk_abcde", "HMK_abcd", "xyz_abcd", "hmk_ab+/", ""]) {
      await expectRefused(db, "api_tokens", token({ token_prefix: prefix }), check);
    }
  });

  it("refuses empty, unknown, mis-cased, null and nested permissions", async () => {
    const check = "api_tokens_permissions_check";
    for (const permissions of [
      [],
      ["admin"],
      ["read", "admin"],
      ["Read"],
      [null],
      ["read", null],
    ]) {
      await expectRefused(db, "api_tokens", token({ permissions }), check);
    }
    await expect(
      db.sql`
        insert into api_tokens (user_id, name, token_hash, token_prefix, permissions, access_mode,
          base_permissions)
        values (${userId}, 'nested', ${"b".repeat(64)}, 'hmk_abcd', '{{read},{edit}}'::text[],
          'deny_list', '{read}')
      `,
    ).rejects.toMatchObject({ constraint_name: check });
  });

  it("accepts null or a list of folders as scope and refuses an empty list", async () => {
    await expectAccepted(db, "api_tokens", token({ folder_scope: [UNKNOWN_ID] }));
    const check = "api_tokens_folder_scope_check";
    await expectRefused(db, "api_tokens", token({ folder_scope: [] }), check);
    await expectRefused(db, "api_tokens", token({ folder_scope: [null] }), check);
  });

  it("refuses an expiry that is not after the creation", async () => {
    const created = new Date("2026-10-01T00:00:00Z");
    const check = "api_tokens_expires_after_created_check";
    await expectRefused(
      db,
      "api_tokens",
      token({ created_at: created, expires_at: created }),
      check,
    );
    await expectAccepted(
      db,
      "api_tokens",
      token({ created_at: created, expires_at: new Date("2026-10-02T00:00:00Z") }),
    );
  });

  it("refuses an unknown owner", async () => {
    await expectRefused(db, "api_tokens", tokenRow(UNKNOWN_ID), "api_tokens_user_id_users_id_fk");
  });
});

describe("api_tokens: uniqueness", () => {
  it("refuses a name a user already has in another case, also when revoked", async () => {
    await insertToken(db, userId, { name: "Laptop", revoked_at: new Date() });
    await expectRefused(
      db,
      "api_tokens",
      token({ name: "laptop" }),
      "api_tokens_user_id_name_unique",
    );
  });

  it("allows the same name for another user", async () => {
    const other = await insertUser(db, "other");
    await insertToken(db, userId, { name: "Shared-Name" });
    await expectAccepted(db, "api_tokens", tokenRow(other, { name: "shared-name" }));
  });

  it("refuses a hash that is already stored", async () => {
    const [first] = await db.sql`insert into api_tokens ${db.sql(token())} returning token_hash`;
    await expectRefused(
      db,
      "api_tokens",
      token({ token_hash: first?.token_hash }),
      "api_tokens_token_hash_unique",
    );
  });

  it("finds a user's tokens through the index on user_id", async () => {
    const plan = await db.sql.begin(async (tx) => {
      await tx`set local enable_seqscan = off`;
      return tx`explain select id from api_tokens where user_id = ${userId}`;
    });
    expect(plan.map((line) => Object.values(line)[0]).join("\n")).toContain(
      "api_tokens_user_id_name_unique",
    );
  });
});
