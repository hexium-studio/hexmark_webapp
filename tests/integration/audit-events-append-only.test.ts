import { beforeAll, describe, expect, it } from "vitest";
import { resetSetupData, type TestDatabase } from "../support/databases";
import {
  APPEND_ONLY,
  agentEvent,
  asPurge,
  humanEvent,
  insertEvent,
  systemEvent,
} from "./audit-harness";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { insertToken } from "./notes-harness";
import { count, insertUser } from "./two-factor-harness";

// The triggers of migration 0009 that keep audit_events append-only: no
// UPDATE except the foreign key setting a deleted user's or token's id to
// null, DELETE and TRUNCATE only with `set local hexmark.audit_purge = 'on'`.

let db: TestDatabase;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
});

const rowOf = async (id: unknown) =>
  (await db.sql`select * from audit_events where id = ${id as string}`)[0];

describe("audit_events: no changes", () => {
  it("refuses changing any column, also to the same value", async () => {
    const userId = await insertUser(db, "changer");
    const event = await insertEvent(db, humanEvent(userId, { reason: "first" }));
    for (const change of [
      db.sql`update audit_events set reason = 'second' where id = ${event.id as string}`,
      db.sql`update audit_events set actor_name = 'someone' where id = ${event.id as string}`,
      db.sql`update audit_events set details = '{"x":1}' where id = ${event.id as string}`,
      db.sql`update audit_events set occurred_at = now() - interval '1 day' where id = ${event.id as string}`,
      db.sql`update audit_events set reason = reason where id = ${event.id as string}`,
      // Directly, even the one change the foreign key may make is refused.
      db.sql`update audit_events set actor_user_id = null where id = ${event.id as string}`,
    ]) {
      await expect(change).rejects.toThrow(APPEND_ONLY);
    }
    expect(await rowOf(event.id)).toEqual(event);
  });

  it("refuses changes from inside another trigger beyond nulling the actor ids", async () => {
    const userId = await insertUser(db, "nested");
    const event = await insertEvent(db, humanEvent(userId));
    await db.sql.unsafe(`
      create table nested_probe (event_id uuid);
      create function nested_probe_touch() returns trigger language plpgsql as $$
      begin update audit_events set reason = 'changed', actor_user_id = null where id = new.event_id;
      return new; end $$;
      create trigger nested_probe_touch after insert on nested_probe
        for each row execute function nested_probe_touch();
    `);
    try {
      await expect(db.sql`insert into nested_probe values (${event.id as string})`).rejects.toThrow(
        APPEND_ONLY,
      );
    } finally {
      await db.sql.unsafe("drop table nested_probe; drop function nested_probe_touch();");
    }
    expect(await rowOf(event.id)).toEqual(event);
  });
});

describe("audit_events: deleting users and tokens", () => {
  it("sets the id of a deleted user to null and keeps the row and its name", async () => {
    const userId = await insertUser(db, "leaver");
    const tokenId = await insertToken(db, userId);
    const human = await insertEvent(db, humanEvent(userId, { actor_name: "leaver" }));
    const agent = await insertEvent(db, agentEvent(tokenId, { actor_name: "leaver-bot" }));

    // Deleting the user also deletes its tokens (cascade).
    await db.sql`delete from users where id = ${userId}`;

    expect(await rowOf(human.id)).toEqual({ ...human, actor_user_id: null });
    expect(await rowOf(agent.id)).toEqual({ ...agent, actor_token_id: null });
    expect(human.actor_name).toBe("leaver");
  });

  it("sets the id of a deleted token to null and leaves revoked tokens alone", async () => {
    const userId = await insertUser(db, "keeper");
    const tokenId = await insertToken(db, userId);
    const revokedId = await insertToken(db, userId);
    const agent = await insertEvent(db, agentEvent(tokenId));
    const other = await insertEvent(db, agentEvent(revokedId));
    const human = await insertEvent(db, humanEvent(userId));

    await db.sql`update api_tokens set revoked_at = now() where id = ${revokedId}`;
    await db.sql`delete from api_tokens where id = ${tokenId}`;

    expect(await rowOf(agent.id)).toEqual({ ...agent, actor_token_id: null });
    expect(await rowOf(other.id)).toEqual(other);
    expect(await rowOf(human.id)).toEqual(human);
  });
});

describe("audit_events: removing rows", () => {
  it("refuses DELETE and TRUNCATE without the purge setting", async () => {
    const event = await insertEvent(db, systemEvent());
    await expect(db.sql`delete from audit_events where id = ${event.id as string}`).rejects.toThrow(
      APPEND_ONLY,
    );
    await expect(db.sql`truncate audit_events`).rejects.toThrow(APPEND_ONLY);
    await expect(db.sql`truncate users cascade`).rejects.toThrow(APPEND_ONLY);
    // A value other than 'on' does not count.
    await expect(
      db.sql.begin(async (tx) => {
        await tx`set local hexmark.audit_purge = 'true'`;
        await tx`delete from audit_events where id = ${event.id as string}`;
      }),
    ).rejects.toThrow(APPEND_ONLY);
    expect(await rowOf(event.id)).toEqual(event);
  });

  it("allows DELETE with the setting, only in that transaction", async () => {
    const old = await insertEvent(db, systemEvent({ occurred_at: new Date("2025-01-01Z") }));
    const kept = await insertEvent(db, systemEvent());
    const removed = await asPurge(
      db,
      (tx) => tx`delete from audit_events where occurred_at < '2025-06-01Z' returning id`,
    );
    expect(removed.map((r) => r.id)).toEqual([old.id]);
    expect(await rowOf(kept.id)).toEqual(kept);
    // The setting ended with the transaction, also on the same connection.
    await expect(
      db.sql.begin(async (tx) => {
        await tx`delete from audit_events where id = ${kept.id as string}`;
      }),
    ).rejects.toThrow(APPEND_ONLY);
  });

  it("allows TRUNCATE with the setting", async () => {
    await insertEvent(db, systemEvent());
    await asPurge(db, (tx) => tx`truncate audit_events`);
    expect(await count(db, "audit_events")).toBe(0);
  });

  it("is cleared by the test reset together with users and tokens", async () => {
    const userId = await insertUser(db, "reset");
    await insertEvent(db, humanEvent(userId));
    await insertEvent(db, agentEvent(await insertToken(db, userId)));
    await resetSetupData(db);
    expect(await count(db, "audit_events")).toBe(0);
    expect(await count(db, "users")).toBe(0);
  });
});
