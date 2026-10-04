import { beforeAll, describe, expect, it } from "vitest";
import {
  type Auth,
  apiToken,
  call,
  type NotesWorld,
  notesApi,
  notesWorld,
  signedIn,
} from "./notes-api-harness";
import { trashTree } from "./trash-harness";

// Ids created through the running server are UUID version 7: those the
// database generates (users, sessions, tokens, folders, notes, revisions) and
// those the server generates itself (trash batches, src/lib/uuid.ts). Rows
// with version 4 ids, as created before migration 0008, keep working.

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let world: NotesWorld;
let ada: Auth;
let adaId: string;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada, id: adaId } = await signedIn(world, "ada"));
});

async function versions(sql: string, ...ids: string[]): Promise<number[]> {
  const rows = await world.db.sql.unsafe(sql, [ids]);
  return rows.map((row) => row.v as number);
}

describe("ids created through the API", () => {
  it("are version 7 in every table the API writes", async () => {
    const { id: tokenId } = await apiToken(world, ada, { name: "uuid", permissions: ["read"] });
    const tree = await trashTree(world, ada, "Ids");
    const ids = [adaId, tokenId, tree.projects, tree.web, tree.plan, tree.spec];
    for (const id of ids) expect(id).toMatch(V7);
    const sessions = await world.db.sql`
      select uuid_extract_version(id) as v from sessions where user_id = ${adaId}
    `;
    expect(sessions.map((row) => row.v)).toEqual(sessions.map(() => 7));
    expect(sessions.length).toBeGreaterThan(0);
    expect(
      await versions(
        "select distinct uuid_extract_version(id) as v from note_revisions where note_id = any($1)",
        tree.plan,
        tree.spec,
      ),
    ).toEqual([7]);
  });

  it("give a trash batch a version 7 id, for a note and for a folder", async () => {
    const tree = await trashTree(world, ada, "Batches");
    await call(world.server, ada, "DELETE", `${notesApi}/notes/${tree.plan}`, {
      expectedVersion: 1,
    });
    await call(world.server, ada, "DELETE", `${notesApi}/folders/${tree.web}`);
    const batches = await world.db.sql`
      select distinct trash_batch_id::text as id from notes where id in (${tree.plan}, ${tree.spec})
      union select distinct trash_batch_id::text from folders where id = ${tree.web}
    `;
    expect(batches).toHaveLength(2);
    for (const { id } of batches) expect(id).toMatch(V7);
  });

  it("still find, edit and trash rows with version 4 ids", async () => {
    const [folder] = await world.db.sql`
      insert into folders (id, name, created_by_user_id, created_by_name, updated_by_user_id,
        updated_by_name)
      values (gen_random_uuid(), 'Old ids', ${adaId}, 'ada', ${adaId}, 'ada') returning id
    `;
    const old = folder?.id as string;
    const created = await call(world.server, ada, "POST", `${notesApi}/notes`, {
      folderId: old,
      title: "New in old",
      body: "# A\n",
    });
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(V7);
    const listed = await call(world.server, ada, "GET", `${notesApi}/tree?folder=${old}`);
    expect(listed).toMatchObject({ status: 200, body: { folder: { id: old } } });
    const trashed = await call(world.server, ada, "DELETE", `${notesApi}/folders/${old}`);
    expect(trashed.status).toBe(200);
    const [row] = await world.db.sql`
      select uuid_extract_version(id) as id_v, uuid_extract_version(trash_batch_id) as batch_v
      from folders where id = ${old}
    `;
    expect(row).toEqual({ id_v: 4, batch_v: 7 });
  });
});
