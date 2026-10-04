import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { TEST_ENCRYPTION_KEY, TEST_INTERNAL_API_KEY } from "../support/hexmark-server";
import { waitFor } from "../support/processes";
import { APPEND_ONLY, humanEvent, insertEvent, systemEvent } from "./audit-harness";
import { allEvents, eventsOf } from "./audit-log-harness";
import { newDatabase, newServer } from "./harness";
import { migrate } from "./migrations";
import { byUser, insertFolder, insertNote } from "./notes-harness";
import { insertUser } from "./two-factor-harness";

// Purges and the audit log, called in this process with a clock of the
// test's choosing: the trash purge writes one system event per note and
// folder it removes; the audit purge removes events older than
// AUDIT_RETENTION_DAYS (only with the purge setting, only in its own
// transaction) and writes one audit.purged event with the count. The
// server runs both hourly and reports an invalid retention.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-04T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let db: TestDatabase;
let owner: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  Object.assign(process.env, {
    POSTGRES_USER: db.server.user,
    POSTGRES_PASSWORD: db.server.password,
    POSTGRES_DB: db.name,
    DB_HOST: db.server.host,
    DB_PORT: String(db.server.port),
    INTERNAL_API_KEY: TEST_INTERNAL_API_KEY,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  });
  delete process.env.SETUP_TOKEN;
  owner = await insertUser(db, "owner");
});

const purgeTrash = async (now: Date) =>
  (await import("../../apps/server/src/services/trash/purge")).purgeExpiredTrash(now, 28);
const purgeAudit = async (now: Date, days = 365) =>
  (await import("../../apps/server/src/services/audit/purge")).purgeAuditEvents(now, days);

const eventId = async (row: Record<string, unknown>) => (await insertEvent(db, row)).id as string;

const trashed = (at: Date, batch: string) => ({
  deleted_at: at,
  ...byUser("deleted_by", owner),
  trash_batch_id: batch,
});

describe("the trash purge", () => {
  it("logs every note and folder it removes as the system, one runId per run", async () => {
    const batch = randomUUID();
    const folder = await insertFolder(db, owner, {
      name: "Gone",
      ...trashed(ago(30 * DAY), batch),
    });
    const note = await insertNote(db, owner, {
      title: "Old note",
      folder_id: folder,
      ...trashed(ago(30 * DAY), batch),
    });
    const { result, events } = await eventsOf(db, () => purgeTrash(NOW));
    expect(result).toEqual({ skipped: false, notes: 1, folders: 1 });
    expect(events.map((e) => [e.action, e.target_id, e.target_label])).toEqual([
      ["note.purged", note, "Gone/Old note"],
      ["folder.purged", folder, "Gone"],
    ]);
    for (const event of events) {
      expect(event).toMatchObject({
        actor_kind: "system",
        actor_name: "System",
        actor_user_id: null,
        source: "system",
        outcome: "success",
        details: { via: "retention", batchId: batch, runId: events[0]?.details.runId },
      });
    }
    // Nothing due: nothing logged.
    expect((await eventsOf(db, () => purgeTrash(NOW))).events).toEqual([]);
  });
});

describe("the audit purge", () => {
  it("removes events at or before the cutoff, logs the count once, and is itself purged", async () => {
    const end = NOW.getTime() - 365 * DAY;
    const due = await eventId(systemEvent({ occurred_at: new Date(end) }));
    const older = await eventId(humanEvent(owner, { occurred_at: new Date(end - DAY) }));
    const kept = await eventId(systemEvent({ occurred_at: new Date(end + 1) }));
    const before = (await allEvents(db)).length;

    const { result, events } = await eventsOf(db, () => purgeAudit(NOW));
    expect(result).toEqual({ skipped: false, removed: 2 });
    const ids = (await allEvents(db)).map((e) => e.id);
    expect(ids).not.toContain(due);
    expect(ids).not.toContain(older);
    expect(ids).toContain(kept);
    expect(ids).toHaveLength(before - 2 + 1);
    expect(events).toEqual([
      expect.objectContaining({
        actor_kind: "system",
        source: "system",
        action: "audit.purged",
        target_kind: "audit",
        details: { removed: 2, retentionDays: 365, cutoff: new Date(end).toISOString() },
      }),
    ]);
    // Nothing due: nothing removed, nothing logged.
    expect(await eventsOf(db, () => purgeAudit(NOW))).toEqual({
      result: { skipped: false, removed: 0 },
      events: [],
    });
    // A day later than the kept event's retention, both it and the first
    // audit.purged event (written at NOW) go when their time comes.
    expect((await purgeAudit(new Date(NOW.getTime() + 365 * DAY))).removed).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("follows the retention it is given and leaves the table append-only afterwards", async () => {
    const id = await eventId(systemEvent({ occurred_at: ago(31 * DAY) }));
    expect((await purgeAudit(NOW, 60)).removed).toBe(0);
    expect((await purgeAudit(NOW, 30)).removed).toBe(1);
    expect((await allEvents(db)).map((e) => e.id)).not.toContain(id);
    const left = (await allEvents(db))[0]?.id as string;
    await expect(db.sql`delete from audit_events where id = ${left}`).rejects.toThrow(APPEND_ONLY);
  });

  it("skips a round while another server purges", async () => {
    await insertEvent(db, systemEvent({ occurred_at: ago(400 * DAY) }));
    await db.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('hexmark.audit_purge'))`;
      expect(await purgeAudit(NOW)).toEqual({ skipped: true, removed: 0 });
    });
    expect((await purgeAudit(NOW)).removed).toBe(1);
  });
});

describe("the server's hourly job", () => {
  it("purges the audit log at start with AUDIT_RETENTION_DAYS, an invalid value logged", async () => {
    const fresh = await newDatabase();
    await migrate(fresh);
    await insertEvent(fresh, systemEvent({ occurred_at: new Date(Date.now() - 40 * DAY) }));
    const line = async (env: Record<string, string>) => {
      const server = await newServer(fresh, { setupToken: null, env });
      let found = "";
      await waitFor(
        "the audit purge at start",
        async () => {
          found =
            server.process
              .tail()
              .split("\n")
              .find((l) => l.includes("Audit purge")) ?? "";
          return found !== "";
        },
        server.process,
      );
      return { found, log: server.process.tail() };
    };
    const invalid = await line({ AUDIT_RETENTION_DAYS: "0" });
    expect(invalid.found).toContain("Audit purge: removed 0 events (retention 365 days).");
    expect(invalid.log).toContain(
      "Configuration error: AUDIT_RETENTION_DAYS must be a whole number between 1 and 3650; " +
        "using the default 365.",
    );
    const month = await line({ AUDIT_RETENTION_DAYS: "30" });
    expect(month.found).toContain("Audit purge: removed 1 events (retention 30 days).");
  });
});
