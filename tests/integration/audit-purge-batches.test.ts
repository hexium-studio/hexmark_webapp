import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { TEST_ENCRYPTION_KEY, TEST_INTERNAL_API_KEY } from "../support/hexmark-server";
import { eventsOf } from "./audit-log-harness";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { byUser, insertFolder, insertNote } from "./notes-harness";
import { insertUser } from "./two-factor-harness";

// The trash purge of a folder batch in the audit log, called in this
// process with a clock of the test's choosing (like audit-purge.test.ts):
// the folder's folder.purged event lists the subfolders and notes removed
// with it (ids and paths), and each of them names it as viaFolder.

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

const trashed = (at: Date, batch: string) => ({
  deleted_at: at,
  ...byUser("deleted_by", owner),
  trash_batch_id: batch,
});

describe("the trash purge of a folder batch", () => {
  it("lists a purged folder batch on its folder's event; each item names it", async () => {
    const batch = randomUUID();
    const top = await insertFolder(db, owner, { name: "Top", ...trashed(ago(40 * DAY), batch) });
    const sub = await insertFolder(db, owner, {
      name: "Sub",
      parent_id: top,
      ...trashed(ago(40 * DAY), batch),
    });
    const inner = await insertNote(db, owner, {
      title: "Inner",
      folder_id: sub,
      ...trashed(ago(40 * DAY), batch),
    });
    const outer = await insertNote(db, owner, {
      title: "Outer",
      folder_id: top,
      ...trashed(ago(40 * DAY), batch),
    });
    const { result, events } = await eventsOf(db, () => purgeTrash(NOW));
    expect(result).toEqual({ skipped: false, notes: 2, folders: 2 });
    expect(events).toHaveLength(4);
    const [root] = events.filter((event) => event.target_id === top);
    expect(root).toMatchObject({
      action: "folder.purged",
      details: {
        batchId: batch,
        folderCount: 1,
        noteCount: 2,
        items: [
          { kind: "note", id: outer, path: "Top/Outer" },
          { kind: "folder", id: sub, path: "Top/Sub" },
          { kind: "note", id: inner, path: "Top/Sub/Inner" },
        ],
      },
    });
    expect(root?.details).not.toHaveProperty("viaFolder");
    for (const event of events.filter((e) => e !== root)) {
      expect(event.details).toMatchObject({ viaFolder: { id: top, path: "Top" } });
      expect(event.details).not.toHaveProperty("items");
    }
  });
});
