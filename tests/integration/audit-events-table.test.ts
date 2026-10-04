import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { agentEvent, humanEvent, insertEvent, systemEvent } from "./audit-harness";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { expectAccepted, expectRefused, insertToken, UNKNOWN_ID } from "./notes-harness";
import { insertUser, tryInsert } from "./two-factor-harness";

// The audit_events table (migration 0009): defaults and the actor, source,
// action and outcome checks both ways. Target, reason, details and the
// indexes are in audit-events-details.test.ts.

let db: TestDatabase;
let userId: string;
let tokenId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
  tokenId = await insertToken(db, userId);
});

const ok = (row: Record<string, unknown>) => expectAccepted(db, "audit_events", row);
const refused = (row: Record<string, unknown>, check: string) =>
  expectRefused(db, "audit_events", row, check);

describe("audit_events: columns", () => {
  it("fills id, time and details by default and leaves the optional columns empty", async () => {
    const row = await insertEvent(db, systemEvent());
    expect(row).toMatchObject({
      actor_user_id: null,
      actor_token_id: null,
      error_code: null,
      target_kind: null,
      target_id: null,
      target_label: null,
      reason: null,
      details: {},
    });
    expect(row.occurred_at).toBeInstanceOf(Date);
    const [v] = await db.sql`select uuid_extract_version(${row.id as string}::uuid) as v`;
    expect(v?.v).toBe(7);
  });

  it("has no column for an IP address", async () => {
    const columns = await db.sql`
      select column_name from information_schema.columns where table_name = 'audit_events'
    `;
    expect(columns.map((c) => c.column_name).filter((n) => /ip|addr/.test(n))).toEqual([]);
  });
});

describe("audit_events: actor", () => {
  it("accepts a human, an agent and the system as the application writes them", async () => {
    await ok(humanEvent(userId));
    await ok(agentEvent(tokenId));
    await ok(systemEvent());
    // Ids already set to null (user or token deleted), names of 1 and 64.
    await ok(humanEvent(userId, { actor_user_id: null, actor_name: "a" }));
    await ok(agentEvent(tokenId, { actor_token_id: null, actor_name: "x".repeat(64) }));
  });

  it("refuses an unknown kind, a missing or bad name and both ids", async () => {
    await refused(systemEvent({ actor_kind: "robot" }), "audit_events_actor_kind_check");
    await refused(systemEvent({ actor_kind: "System" }), "audit_events_actor_kind_check");
    for (const actor_name of ["", "x".repeat(65)]) {
      await refused(humanEvent(userId, { actor_name }), "audit_events_actor_name_length_check");
    }
    await expect(insertEvent(db, humanEvent(userId, { actor_name: null }))).rejects.toMatchObject({
      code: "23502",
      column_name: "actor_name",
    });
    // Both ids break two checks; PostgreSQL names one of them.
    for (const row of [
      humanEvent(userId, { actor_token_id: tokenId }),
      agentEvent(tokenId, { actor_user_id: userId }),
    ]) {
      await expect(tryInsert(db, "audit_events", row)).rejects.toMatchObject({
        constraint_name: expect.stringMatching(/^audit_events_actor_(single_id|kind_ids)_check$/),
      });
    }
  });

  it("refuses ids that do not fit the kind, and a system not named System", async () => {
    const check = "audit_events_actor_kind_ids_check";
    await refused(humanEvent(userId, { actor_user_id: null, actor_token_id: tokenId }), check);
    await refused(agentEvent(tokenId, { actor_token_id: null, actor_user_id: userId }), check);
    await refused(systemEvent({ actor_user_id: userId }), check);
    await refused(systemEvent({ actor_token_id: tokenId }), check);
    await refused(systemEvent({ actor_name: "system" }), check);
    await refused(systemEvent({ actor_name: "owner" }), check);
  });

  it("refuses ids of users and tokens that do not exist", async () => {
    await expect(insertEvent(db, humanEvent(UNKNOWN_ID))).rejects.toMatchObject({
      constraint_name: "audit_events_actor_user_id_users_id_fk",
    });
    await expect(insertEvent(db, agentEvent(UNKNOWN_ID))).rejects.toMatchObject({
      constraint_name: "audit_events_actor_token_id_api_tokens_id_fk",
    });
  });
});

describe("audit_events: source, action and outcome", () => {
  it("accepts every source and dotted action codes up to 64 characters", async () => {
    for (const source of ["web", "http", "mcp", "system"]) await ok(systemEvent({ source }));
    for (const action of ["note.updated", "folder.renamed", "auth.sign_in_failed", "a.b.c"]) {
      await ok(systemEvent({ action }));
    }
    await ok(systemEvent({ action: `a.${"b".repeat(62)}` }));
  });

  it("refuses unknown sources and malformed or too long actions", async () => {
    for (const source of ["cli", "Web", ""]) {
      await refused(systemEvent({ source }), "audit_events_source_check");
    }
    const check = "audit_events_action_format_check";
    for (const action of [
      "note",
      "note.",
      ".note",
      "note..updated",
      "Note.updated",
      "note.updated2",
      "note-updated.x",
      "note updated.x",
      "notexupdated",
      `a.${"b".repeat(63)}`,
      "",
    ]) {
      await refused(systemEvent({ action }), check);
    }
  });

  it("requires an error code for a failure and none for a success", async () => {
    const check = "audit_events_error_code_check";
    await ok(systemEvent({ outcome: "failure", error_code: "version_conflict" }));
    await ok(systemEvent({ outcome: "failure", error_code: `e${"x".repeat(63)}` }));
    await refused(systemEvent({ outcome: "failure" }), check);
    await refused(systemEvent({ outcome: "failure", error_code: null }), check);
    await refused(systemEvent({ error_code: "not_found" }), check);
    for (const error_code of ["", "Not_found", "not-found", "1x", `e${"x".repeat(64)}`]) {
      await refused(systemEvent({ outcome: "failure", error_code }), check);
    }
    for (const outcome of ["failed", "Success", ""]) {
      // Neither branch of the error code check fits either, so it may be named.
      await expect(tryInsert(db, "audit_events", systemEvent({ outcome }))).rejects.toMatchObject({
        constraint_name: expect.stringMatching(/^audit_events_(outcome|error_code)_check$/),
      });
    }
  });
});
