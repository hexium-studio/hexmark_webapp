import { describe, expect, it } from "vitest";
import { humanEvent, insertEvent } from "./audit-harness";
import { newDatabase } from "./harness";
import { firstMigrations, migrate } from "./migrations";
import { count } from "./two-factor-harness";
import { allRows, seedEveryTable } from "./uuid-harness";

// Migration 0009 on a database that already holds rows in every table: it
// only adds the empty audit_events table; every existing row stays exactly
// as it was, and existing users can be referenced right away.

describe("migration 0009 on a database with existing rows", () => {
  it("keeps every row and adds an empty audit_events table", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(9));
    const old = await seedEveryTable(db);
    // A note in the trash and a revoked token, as earlier migrations allow.
    await db.sql`
      update notes set deleted_at = now(), deleted_by_user_id = updated_by_user_id,
        deleted_by_name = updated_by_name, trash_batch_id = gen_random_uuid()
      where id = ${old.notes}
    `;
    await db.sql`update api_tokens set revoked_at = now() where id = ${old.api_tokens}`;
    const before = await allRows(db);
    expect(before.has("audit_events")).toBe(false);

    await migrate(db, firstMigrations(10));

    const after = await allRows(db);
    expect(after.get("audit_events")).toEqual([]);
    after.delete("audit_events");
    expect(after).toEqual(before);
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(10);

    // Rows of before the migration can be referenced, and deleting them
    // afterwards still works.
    const event = await insertEvent(db, humanEvent(old.users));
    await db.sql`delete from users where id = ${old.users}`;
    const [row] = await db.sql`select actor_user_id, actor_name from audit_events`;
    expect(row).toEqual({ actor_user_id: null, actor_name: event.actor_name });

    await migrate(db, firstMigrations(10));
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(10);
  });

  it("upgrades an instance whose setup is not done yet", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(9));

    await migrate(db, firstMigrations(10));

    expect(await count(db, "audit_events")).toBe(0);
    expect(await count(db, "users")).toBe(0);
    const triggers = await db.sql`
      select tgname from pg_trigger where tgrelid = 'audit_events'::regclass and not tgisinternal
      order by 1
    `;
    expect(triggers.map((t) => t.tgname)).toEqual([
      "audit_events_refuse_delete",
      "audit_events_refuse_truncate",
      "audit_events_refuse_update",
    ]);
  });
});
