import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { systemEvent } from "./audit-harness";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { expectAccepted, expectRefused, UNKNOWN_ID } from "./notes-harness";

// The audit_events table (migration 0009): the target, reason and details
// checks both ways, and the indexes for the filters of the log. Actor,
// source, action and outcome are in audit-events-table.test.ts.

let db: TestDatabase;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
});

const ok = (row: Record<string, unknown>) => expectAccepted(db, "audit_events", row);
const refused = (row: Record<string, unknown>, check: string) =>
  expectRefused(db, "audit_events", row, check);

describe("audit_events: target, reason and details", () => {
  it("accepts a target with kind, id and label, or the kind alone", async () => {
    const label = "x".repeat(1000);
    await ok(
      systemEvent({ target_kind: "trash_batch", target_id: UNKNOWN_ID, target_label: label }),
    );
    await ok(systemEvent({ target_kind: "settings" }));
    // No foreign key: the target may be gone (purged note, deleted user).
    await ok(systemEvent({ target_kind: "note", target_id: UNKNOWN_ID }));
  });

  it("refuses an id or label without kind, a bad kind and a bad label", async () => {
    const pairing = "audit_events_target_pairing_check";
    await refused(systemEvent({ target_id: UNKNOWN_ID }), pairing);
    await refused(systemEvent({ target_label: "Plans/Q4" }), pairing);
    for (const target_kind of ["", "Note", "trash-batch", "_note", "x".repeat(33)]) {
      await refused(systemEvent({ target_kind }), "audit_events_target_kind_format_check");
    }
    for (const target_label of ["", "x".repeat(1001)]) {
      await refused(
        systemEvent({ target_kind: "note", target_label }),
        "audit_events_target_label_length_check",
      );
    }
  });

  it("accepts a reason up to 500 characters and refuses a longer one", async () => {
    await ok(systemEvent({ reason: "x".repeat(500) }));
    await refused(systemEvent({ reason: "x".repeat(501) }), "audit_events_reason_length_check");
  });

  it("accepts objects up to 16 KB as details and refuses anything else", async () => {
    // Random hex does not compress, so the stored size is about its length.
    const hex = (n: number) =>
      Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("hex");
    await ok(systemEvent({ details: { input: { title: "Plan" }, count: 3 } }));
    await ok(systemEvent({ details: { blob: hex(7_500) } }));
    await refused(
      systemEvent({ details: { blob: hex(8_500) } }),
      "audit_events_details_size_check",
    );
    const check = "audit_events_details_object_check";
    for (const details of [[], "text", 1, null]) {
      const json = db.sql`${JSON.stringify(details)}::jsonb`;
      await refused(systemEvent({ details: json }), check);
    }
  });
});

describe("audit_events: indexes", () => {
  it("has the indexes for the filters of the log", async () => {
    const rows = await db.sql`
      select indexname, indexdef from pg_indexes where tablename = 'audit_events' order by 1
    `;
    const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef.split(" USING ")[1]]));
    expect(defs).toEqual({
      audit_events_pkey: "btree (id)",
      audit_events_occurred_at_idx: "btree (occurred_at DESC)",
      audit_events_actor_name_idx: "btree (actor_name, occurred_at DESC)",
      audit_events_actor_user_id_idx: "btree (actor_user_id, occurred_at DESC)",
      audit_events_actor_token_id_idx: "btree (actor_token_id, occurred_at DESC)",
      audit_events_action_idx: "btree (action, occurred_at DESC)",
      audit_events_failure_idx:
        "btree (outcome, occurred_at DESC) WHERE (outcome = 'failure'::text)",
      audit_events_target_idx: "btree (target_kind, target_id)",
    });
  });
});
