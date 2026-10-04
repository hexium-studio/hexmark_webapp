import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import type { HexmarkServer } from "../support/hexmark-server";
import { waitFor } from "../support/processes";
import { newDatabase, newServer } from "./harness";
import { migrate } from "./migrations";
import { byUser, insertNote } from "./notes-harness";
import { insertUser } from "./two-factor-harness";

// The server runs the purge by itself once its database is ready, logs what
// it removed (counts only) and uses TRASH_RETENTION_DAYS, falling back to
// 28 days with a logged configuration error for an invalid value.

const DAY = 24 * 60 * 60 * 1000;

async function seeded(): Promise<{ db: TestDatabase; due: string; kept: string }> {
  const db = await newDatabase();
  await migrate(db);
  const owner = await insertUser(db, "owner");
  const trash = (daysAgo: number) => ({
    deleted_at: new Date(Date.now() - daysAgo * DAY),
    ...byUser("deleted_by", owner),
    trash_batch_id: randomUUID(),
  });
  const due = await insertNote(db, owner, { title: "Due secret title", ...trash(29) });
  const kept = await insertNote(db, owner, { title: "Kept", ...trash(10) });
  return { db, due, kept };
}

async function purgeLine(server: HexmarkServer): Promise<string> {
  let line = "";
  await waitFor(
    "the trash purge at start",
    async () => {
      line =
        server.process
          .tail()
          .split("\n")
          .find((entry) => entry.includes("Trash purge")) ?? "";
      return line !== "";
    },
    server.process,
  );
  return line;
}

async function remaining(db: TestDatabase, ids: string[]): Promise<string[]> {
  const rows = await db.sql`select id from notes where id in ${db.sql(ids)}`;
  return ids.filter((id) => rows.some((row) => row.id === id));
}

describe("the purge job", () => {
  it("purges what is due when the server starts and logs counts, no titles", async () => {
    const { db, due, kept } = await seeded();
    const server = await newServer(db, { setupToken: null });
    const line = await purgeLine(server);
    expect(line).toContain("Trash purge: removed 1 notes and 0 folders (retention 28 days).");
    expect(server.process.tail()).not.toContain("Due secret title");
    expect(await remaining(db, [due, kept])).toEqual([kept]);
  });

  it("uses TRASH_RETENTION_DAYS", async () => {
    const { db, due, kept } = await seeded();
    const server = await newServer(db, { setupToken: null, env: { TRASH_RETENTION_DAYS: "5" } });
    expect(await purgeLine(server)).toContain("removed 2 notes and 0 folders (retention 5 days)");
    expect(await remaining(db, [due, kept])).toEqual([]);
  });

  it("logs an invalid value and keeps the default", async () => {
    const { db, due, kept } = await seeded();
    const server = await newServer(db, { setupToken: null, env: { TRASH_RETENTION_DAYS: "0" } });
    expect(await purgeLine(server)).toContain("(retention 28 days)");
    expect(server.process.tail()).toContain(
      "Configuration error: TRASH_RETENTION_DAYS must be a whole number between 1 and 3650; " +
        "using the default 28.",
    );
    expect(await remaining(db, [due, kept])).toEqual([kept]);
  });
});
