import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { TEST_ENCRYPTION_KEY, TEST_INTERNAL_API_KEY } from "../support/hexmark-server";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { byUser, insertFolder, insertNote, insertRow } from "./notes-harness";
import { tableCounts } from "./trash-harness";
import { insertUser } from "./two-factor-harness";

// The purge (services/trash/purge.ts), called in this process with a clock
// of the test's choosing: it removes exactly what was deleted at least the
// retention ago - notes with their revisions and sections, folders after
// their contents - and nothing else; and only one purge runs at a time.
// The server running it at start: trash-purge-job.test.ts.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-03T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let db: TestDatabase;
let owner: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  // The server's configuration is read when its modules are first imported.
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

async function purge(now: Date, days = 28) {
  const { purgeExpiredTrash } = await import("../../apps/server/src/services/trash/purge");
  return purgeExpiredTrash(now, days);
}

// The trash columns for a row deleted at `at`.
function deleted(at: Date, batch: string = randomUUID()) {
  return { deleted_at: at, ...byUser("deleted_by", owner), trash_batch_id: batch };
}

// A note with a revision and a section, as the services write them.
async function note(values: Record<string, unknown>): Promise<string> {
  const id = await insertNote(db, owner, values);
  await insertRow(db, "note_revisions", {
    note_id: id,
    version: 1,
    title: "t",
    body: "",
    change: "created",
    ...byUser("actor", owner),
  });
  await db.sql`
    insert into note_sections (note_id, position, level, heading, path, start_offset,
      end_offset, subtree_end_offset, characters, approx_tokens, search)
    values (${id}, 0, 0, '', '(introduction)', 0, 0, 0, 0, 0, ''::tsvector)`;
  return id;
}

async function existing(table: "notes" | "folders", ids: string[]): Promise<string[]> {
  const rows = await db.sql`select id from ${db.sql(table)} where id in ${db.sql(ids)}`;
  return ids.filter((id) => rows.some((row) => row.id === id));
}

describe("purging", () => {
  it("removes what is due, children before parents, and keeps everything else", async () => {
    const batch = randomUUID();
    // Due: a note deleted exactly 28 days ago; a folder tree deleted 30 days ago.
    const dueNote = await note({ title: "due", ...deleted(ago(28 * DAY)) });
    const top = await insertFolder(db, owner, { name: "top", ...deleted(ago(30 * DAY), batch) });
    const sub = await insertFolder(db, owner, {
      name: "sub",
      parent_id: top,
      ...deleted(ago(30 * DAY), batch),
    });
    const inSub = await note({ title: "in sub", folder_id: sub, ...deleted(ago(30 * DAY), batch) });
    // Not due: deleted a second less than 28 days ago.
    const fresh = await note({ title: "fresh", ...deleted(ago(28 * DAY - 1000)) });
    // A folder that is due but still holds a note that is not: both stay.
    const holder = await insertFolder(db, owner, { name: "holder", ...deleted(ago(40 * DAY)) });
    const late = await note({ title: "late", folder_id: holder, ...deleted(ago(DAY)) });
    // In use, also an old one.
    const liveFolder = await insertFolder(db, owner, { name: "live" });
    const liveNote = await note({
      title: "live",
      folder_id: liveFolder,
      created_at: ago(400 * DAY),
    });
    const before = await tableCounts(db);
    expect(before).toMatchObject({ notes: 5, folders: 4, revisions: 5, sections: 5 });

    const report = await purge(NOW);
    expect(report).toEqual({ skipped: false, notes: 2, folders: 2 });

    expect(await existing("notes", [dueNote, inSub, fresh, late, liveNote])).toEqual([
      fresh,
      late,
      liveNote,
    ]);
    expect(await existing("folders", [top, sub, holder, liveFolder])).toEqual([holder, liveFolder]);
    // Revisions and sections went with their notes, and only those.
    expect(await tableCounts(db)).toEqual({
      notes: 3,
      folders: 2,
      revisions: 3,
      sections: 3,
      notes_in_trash: 2,
      folders_in_trash: 1,
    });
    const owned = await db.sql`select distinct note_id from note_revisions order by note_id`;
    expect(owned.map((row) => row.note_id).sort()).toEqual([fresh, late, liveNote].sort());

    // A second run finds nothing more.
    expect(await purge(NOW)).toEqual({ skipped: false, notes: 0, folders: 0 });
  });

  it("purges on day 29: a millisecond before the retention ends nothing, then the item", async () => {
    const deletedAt = new Date("2026-08-01T08:00:00.000Z");
    const id = await note({ title: "boundary", ...deleted(deletedAt) });
    const end = deletedAt.getTime() + 28 * DAY;
    expect(await purge(new Date(end - 1))).toMatchObject({ notes: 0 });
    expect(await existing("notes", [id])).toEqual([id]);
    expect(await purge(new Date(end))).toMatchObject({ notes: 1 });
    expect(await existing("notes", [id])).toEqual([]);
  });

  it("follows the retention it is given", async () => {
    // Notes of the tests before stay in the trash too; only this one is looked at.
    const id = await note({ title: "week", ...deleted(ago(8 * DAY)) });
    await purge(NOW, 10);
    expect(await existing("notes", [id])).toEqual([id]);
    await purge(NOW, 7);
    expect(await existing("notes", [id])).toEqual([]);
  });

  it("skips while another purge holds the lock, and runs once it is free", async () => {
    const id = await note({ title: "locked", ...deleted(ago(90 * DAY)) });
    const reserved = db.sql.reserve();
    const connection = await reserved;
    try {
      await connection`begin`;
      await connection`select pg_advisory_xact_lock(hashtext('hexmark.trash_removal'))`;
      expect(await purge(NOW)).toEqual({ skipped: true, notes: 0, folders: 0 });
      expect(await existing("notes", [id])).toEqual([id]);
      await connection`commit`;
    } finally {
      connection.release();
    }
    expect(await purge(NOW)).toEqual({ skipped: false, notes: 1, folders: 0 });
  });

  it("lets only one of two purges at the same moment do the work", async () => {
    const ids = await Promise.all(
      Array.from({ length: 20 }, (_, i) => note({ title: `twin ${i}`, ...deleted(ago(60 * DAY)) })),
    );
    const reports = await Promise.all([purge(NOW), purge(NOW)]);
    const removed = reports.reduce((sum, report) => sum + report.notes, 0);
    expect(removed).toBe(20);
    expect(await existing("notes", ids)).toEqual([]);
  });
});
