import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { TEST_ENCRYPTION_KEY, TEST_INTERNAL_API_KEY } from "../support/hexmark-server";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { insertFolder } from "./notes-harness";
import { insertUser } from "./two-factor-harness";

// runNoteTransaction (services/notes/transaction.ts), called in this
// process: when PostgreSQL aborts it as one side of a deadlock, the
// operation runs again from the start instead of failing. Writes into the
// trash lock folders and notes in different orders than other writes, so
// this is what keeps a race from turning into a 500.

let db: TestDatabase;
let first: string;
let second: string;

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
  const owner = await insertUser(db, "owner");
  first = await insertFolder(db, owner, { name: "first" });
  second = await insertFolder(db, owner, { name: "second" });
});

describe("a deadlock", () => {
  it("runs the aborted operation again, which then succeeds", async () => {
    const { runNoteTransaction } = await import("../../apps/server/src/services/notes/transaction");
    const other = await db.sql.reserve();
    let otherDone: Promise<unknown> | undefined;
    try {
      // The other side holds `second` and gives PostgreSQL a long time before
      // it checks for a deadlock itself, so the operation is the one aborted.
      await other`begin`;
      await other`set local deadlock_timeout = '20s'`;
      await other`select id from folders where id = ${second} for update`;
      let attempts = 0;
      const outcome = await runNoteTransaction(async (tx) => {
        attempts++;
        await tx.execute(`select id from folders where id = '${first}' for update`);
        if (attempts === 1) {
          // Waits for `first`, which the operation holds: a deadlock once the
          // operation asks for `second`. It commits as soon as it gets `first`.
          otherDone = other`select id from folders where id = ${first} for update`.then(
            () => other`commit`,
          );
        }
        await tx.execute(`select id from folders where id = '${second}' for update`);
        return attempts;
      });
      expect(outcome).toEqual({ ok: true, value: 2 });
      await otherDone;
    } finally {
      other.release();
    }
    expect(otherDone).toBeDefined();
  });
});
