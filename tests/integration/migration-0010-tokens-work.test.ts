import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { seedUser } from "./auth-harness";
import { newDatabase, newServer } from "./harness";
import { connectMcp, tool } from "./mcp-harness";
import { firstMigrations, migrate } from "./migrations";
import { call, notesApi } from "./notes-api-harness";

// A token made before migration 0010 keeps working afterwards, through the
// new access evaluation: one for the whole wiki (like the owner's token
// "Test": read, search, create, edit, move, delete) becomes a deny_list
// without entries and can do exactly what it could; one limited to a folder
// becomes an allow_list and still sees only that folder.

const OWNER_SET = ["read", "search", "create", "edit", "move", "delete"];

function legacyToken() {
  const token = `hmk_${randomBytes(32).toString("base64url")}`;
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

describe("tokens from before migration 0010", () => {
  it("work as they did, through the access modes", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(10));
    const owner = await seedUser(db, "owner");
    const [folder] = await db.sql`
      insert into folders (name, created_by_user_id, created_by_name, updated_by_user_id,
        updated_by_name)
      values ('Team', ${owner.id}, 'owner', ${owner.id}, 'owner') returning id`;
    const whole = legacyToken();
    const scoped = legacyToken();
    await db.sql`
      insert into api_tokens (user_id, name, token_hash, token_prefix, permissions, folder_scope)
      values
        (${owner.id}, 'Test', ${whole.hash}, ${whole.token.slice(0, 8)}, ${OWNER_SET}, null),
        (${owner.id}, 'Scoped', ${scoped.hash}, ${scoped.token.slice(0, 8)}, ${["read", "create"]},
          ${[folder?.id]})`;

    await migrate(db);
    const rows = await db.sql`
      select name, access_mode, base_permissions,
        (select count(*)::int from api_token_entries e where e.token_id = t.id) as entries
      from api_tokens t order by name`;
    expect(rows).toEqual([
      { name: "Scoped", access_mode: "allow_list", base_permissions: null, entries: 1 },
      { name: "Test", access_mode: "deny_list", base_permissions: OWNER_SET, entries: 0 },
    ]);

    const server = await newServer(db, { setupToken: null });
    const test = { bearer: whole.token };
    const api = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) =>
      call(server, test, method, `${notesApi}${path}`, body);
    const created = await api("POST", "/folders", { name: "Made by Test", parentId: null });
    expect(created.status).toBe(201);
    const note = await api("POST", "/notes", {
      folderId: created.body.id,
      title: "Note",
      body: "# Note\n\nwombat\n",
    });
    expect(note.status).toBe(201);
    const id = note.body.id as string;
    expect(
      (await api("PATCH", `/notes/${id}`, { expectedVersion: 1, body: "wombat 2" })).status,
    ).toBe(200);
    expect(
      (await api("POST", `/notes/${id}/move`, { expectedVersion: 2, folderId: null })).status,
    ).toBe(200);
    expect(((await api("GET", "/search?q=wombat")).body.hits as unknown[]).length).toBe(1);
    expect((await api("GET", `/notes/${id}`)).status).toBe(200);
    expect((await api("DELETE", `/notes/${id}`, { expectedVersion: 3 })).status).toBe(200);
    // It never had lock, and still has not.
    expect(await api("POST", `/folders/${created.body.id}/lock`, { reason: "x" })).toMatchObject({
      status: 403,
      body: { permission: "lock" },
    });
    const agent = await connectMcp(server, whole.token);
    const overview = await tool(agent, "get_overview");
    expect(overview.data.access).toMatchObject({
      actorName: "Test",
      mode: "deny_list",
      permissions: OWNER_SET,
      entries: null,
    });
    expect(JSON.stringify(overview.data.tree)).toContain("Team");

    const limited = await call(server, { bearer: scoped.token }, "GET", `${notesApi}/tree`);
    expect((limited.body.folders as { id: string }[]).map((entry) => entry.id)).toEqual([
      folder?.id,
    ]);
    const outside = await call(server, { bearer: scoped.token }, "POST", `${notesApi}/notes`, {
      folderId: null,
      title: "Root",
      body: "x",
    });
    expect(outside).toMatchObject({ status: 403, body: { reason: "outside_scope" } });
  });
});
