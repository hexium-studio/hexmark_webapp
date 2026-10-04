import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { expectAccepted, expectRefused, legacyTokenRow, tokenRow } from "./notes-harness";
import { insertUser, tryInsert } from "./two-factor-harness";

// The access mode of api_tokens (migration 0010): access_mode and
// base_permissions, and the legacy columns permissions and folder_scope,
// which stay for one release and may now be null.

let db: TestDatabase;
let userId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
});

const ALL = ["read", "search", "create", "edit", "move", "delete", "lock"];

// A token as a server of the new version writes it: no legacy columns.
const token = (values: Record<string, unknown> = {}) =>
  tokenRow(userId, { permissions: null, ...values });
const allowList = (values: Record<string, unknown> = {}) =>
  token({ access_mode: "allow_list", base_permissions: null, ...values });

describe("api_tokens: access mode", () => {
  it("accepts both modes without the legacy columns", async () => {
    const [deny] = await db.sql`insert into api_tokens ${db.sql(token())} returning *`;
    expect(deny).toMatchObject({
      access_mode: "deny_list",
      base_permissions: ["read", "search"],
      permissions: null,
      folder_scope: null,
    });
    await expectAccepted(db, "api_tokens", allowList());
  });

  it("has no default mode", async () => {
    await expect(tryInsert(db, "api_tokens", legacyTokenRow(userId))).rejects.toMatchObject({
      code: "23502",
      column_name: "access_mode",
    });
  });

  it("refuses an unknown mode", async () => {
    for (const mode of ["allow", "Deny_list", "", "whole_wiki"]) {
      await expectRefused(
        db,
        "api_tokens",
        token({ access_mode: mode }),
        "api_tokens_access_mode_check",
      );
    }
  });

  it("requires base permissions exactly for deny_list", async () => {
    const check = "api_tokens_base_permissions_mode_check";
    await expectRefused(db, "api_tokens", token({ base_permissions: null }), check);
    await expectRefused(db, "api_tokens", allowList({ base_permissions: ["read"] }), check);
  });

  it("accepts every known permission as base set", async () => {
    await expectAccepted(db, "api_tokens", token({ base_permissions: ALL }));
    for (const permission of ALL) {
      await expectAccepted(db, "api_tokens", token({ base_permissions: [permission] }));
    }
  });

  it("refuses empty, unknown, mis-cased, null and nested base permissions", async () => {
    const check = "api_tokens_base_permissions_check";
    for (const base of [[], ["admin"], ["read", "admin"], ["Read"], [null], ["read", null]]) {
      await expectRefused(db, "api_tokens", token({ base_permissions: base }), check);
    }
    await expect(
      db.sql`
        insert into api_tokens (user_id, name, token_hash, token_prefix, access_mode,
          base_permissions)
        values (${userId}, 'nested', ${"c".repeat(64)}, 'hmk_abcd', 'deny_list',
          '{{read},{edit}}'::text[])
      `,
    ).rejects.toMatchObject({ constraint_name: check });
  });

  it("still checks the legacy columns when they are set", async () => {
    await expectAccepted(db, "api_tokens", token({ permissions: ALL, folder_scope: null }));
    await expectRefused(
      db,
      "api_tokens",
      token({ permissions: ["admin"] }),
      "api_tokens_permissions_check",
    );
    await expectRefused(
      db,
      "api_tokens",
      token({ folder_scope: [] }),
      "api_tokens_folder_scope_check",
    );
  });
});
