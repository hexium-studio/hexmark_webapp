import { createHash } from "node:crypto";
import { API_TOKEN_PATTERN } from "@hexmark/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { seedUser, signIn } from "./auth-harness";
import { newServer } from "./harness";
import {
  type Auth,
  apiToken,
  call,
  type NotesWorld,
  notesWorld,
  reauthenticated,
  signedIn,
} from "./notes-api-harness";

// /api/tokens/v1: creating (shown once, with the MCP client block, only
// with the password re-entered recently), listing and revoking API tokens,
// from a session only.

const tokensPath = "/api/tokens/v1/tokens";
const MCP_URL = "https://wiki.example.com/mcp";

let world: NotesWorld;
let ada: Auth;
let adaId: string;

beforeAll(async () => {
  world = await notesWorld({ MCP_PUBLIC_URL: `${MCP_URL}/` });
  ({ auth: ada, id: adaId } = await signedIn(world, "ada"));
});

describe("creating", () => {
  it("returns the token once with the mcpServers block and stores only its digest", async () => {
    const response = await call(world.server, ada, "POST", tokensPath, {
      name: " claude-code ",
      mode: "deny_list",
      basePermissions: ["edit", "read", "read"],
    });
    expect(response.status).toBe(201);
    const token = response.body.token as string;
    expect(token).toMatch(API_TOKEN_PATTERN);
    expect(response.body.info).toMatchObject({
      name: "claude-code",
      prefix: token.slice(0, 8),
      mode: "deny_list",
      basePermissions: ["read", "edit"],
      entries: [],
      revokedAt: null,
    });
    expect(response.body.mcp).toEqual({
      serverName: "hexmark",
      url: MCP_URL,
      config: {
        mcpServers: {
          hexmark: { type: "http", url: MCP_URL, headers: { Authorization: `Bearer ${token}` } },
        },
      },
    });
    const rows = await world.db.sql`
      select token_hash, token_prefix, user_id, access_mode, base_permissions, permissions,
        folder_scope
      from api_tokens where name = 'claude-code'`;
    // The legacy columns stay empty for new tokens.
    expect(rows).toEqual([
      {
        token_hash: createHash("sha256").update(token).digest("hex"),
        token_prefix: token.slice(0, 8),
        user_id: adaId,
        access_mode: "deny_list",
        base_permissions: ["read", "edit"],
        permissions: null,
        folder_scope: null,
      },
    ]);
    const list = await call(world.server, ada, "GET", tokensPath);
    expect(JSON.stringify(list.body)).not.toContain(token);
  });

  it("refuses bad input, taken names, unknown targets and permissions beyond the role", async () => {
    const post = (body: Record<string, unknown>, auth: Auth = ada) =>
      call(world.server, auth, "POST", tokensPath, body);
    const deny = { mode: "deny_list", basePermissions: ["read"] };
    expect((await post({ name: "", ...deny })).body.fields).toMatchObject({
      name: { code: "required" },
    });
    // No default mode: it decides what new content the token reaches.
    expect(await post({ name: "x", basePermissions: ["read"] })).toMatchObject({
      status: 400,
      body: { fields: { mode: { code: "required" } } },
    });
    expect((await post({ name: "x", mode: "whole_wiki" })).body.fields).toMatchObject({
      mode: { code: "invalid_option" },
    });
    expect((await post({ name: "x", mode: "deny_list" })).body.fields).toMatchObject({
      basePermissions: { code: "required" },
    });
    expect((await post({ name: "x", ...deny, basePermissions: [] })).body.fields).toMatchObject({
      basePermissions: { code: "required" },
    });
    expect((await post({ name: "x", mode: "deny_list", basePermissions: ["admin"] })).status).toBe(
      400,
    );
    const past = new Date(Date.now() - 1000).toISOString();
    expect((await post({ name: "x", ...deny, expiresAt: past })).status).toBe(400);
    await apiToken(world, ada, { name: "Twin", ...deny });
    expect((await post({ name: "twin", ...deny })).body.error).toBe("name_taken");
    const unknown = "00000000-0000-4000-8000-000000000000";
    const entry = { kind: "folder", id: unknown, permissions: ["read"] };
    const scope = await post({ name: "scoped", mode: "allow_list", entries: [entry] });
    expect(scope).toMatchObject({ status: 404, body: { error: "folder_not_found" } });
    const note = await post({
      name: "scoped",
      mode: "allow_list",
      entries: [{ ...entry, kind: "note" }],
    });
    expect(note).toMatchObject({ status: 404, body: { error: "not_found", noteIds: [unknown] } });
    const { auth: guest } = await signedIn(world, "gwen", "guest");
    const beyond = await post(
      { name: "too-much", mode: "deny_list", basePermissions: ["read", "edit"] },
      guest,
    );
    expect(beyond).toMatchObject({ status: 403, body: { permissions: ["edit"] } });
    const [count] = await world.db.sql`
      select count(*)::int as n from api_tokens where name in ('x', 'scoped', 'too-much')`;
    expect(count?.n).toBe(0);
  });
});

describe("recent password re-entry", () => {
  const tokenCount = async (userId: string) => {
    const [row] = await world.db.sql`
      select count(*)::int as n from api_tokens where user_id = ${userId}`;
    return row?.n as number;
  };

  it("is required to create a token, decided on the session row", async () => {
    const { auth: rita, id: ritaId } = await signedIn(world, "rita", "user", false);
    const body = { name: "needs-password", mode: "deny_list", basePermissions: ["read"] };
    const before = await tokenCount(ritaId);
    const refused = await call(world.server, rita, "POST", tokensPath, body);
    expect(refused).toEqual({ status: 403, body: { error: "reauthentication_required" } });
    expect(await tokenCount(ritaId)).toBe(before);

    await reauthenticated(world.server, rita);
    const [session] = await world.db.sql`
      select reauthenticated_at from sessions where user_id = ${ritaId}`;
    expect(session?.reauthenticated_at).toBeInstanceOf(Date);
    expect((await call(world.server, rita, "POST", tokensPath, body)).status).toBe(201);
    expect(await tokenCount(ritaId)).toBe(before + 1);

    // Older than the 10-minute window counts as not re-entered.
    await world.db
      .sql`update sessions set reauthenticated_at = now() - interval '10 minutes 5 seconds'
      where user_id = ${ritaId}`;
    const stale = await call(world.server, rita, "POST", tokensPath, { ...body, name: "late" });
    expect(stale).toMatchObject({ status: 403, body: { error: "reauthentication_required" } });
    expect(await tokenCount(ritaId)).toBe(before + 1);
  });

  it("is not required to list or revoke a token", async () => {
    const { auth: otto, id: ottoId } = await signedIn(world, "otto");
    const token = await apiToken(world, otto, { name: "to-revoke", permissions: ["read"] });
    await world.db.sql`update sessions set reauthenticated_at = null where user_id = ${ottoId}`;
    expect((await call(world.server, otto, "GET", tokensPath)).status).toBe(200);
    const revoked = await call(world.server, otto, "DELETE", `${tokensPath}/${token.id}`);
    expect(revoked.status).toBe(200);
    const [row] = await world.db.sql`select revoked_at from api_tokens where id = ${token.id}`;
    expect(row?.revoked_at).toBeInstanceOf(Date);
  });
});

describe("managing", () => {
  it("lists and revokes only one's own tokens, from a session only", async () => {
    const own = await apiToken(world, ada, { name: "mine", permissions: ["read"] });
    const { auth: eve } = await signedIn(world, "eve");
    const foreign = await call(world.server, eve, "DELETE", `${tokensPath}/${own.id}`);
    expect(foreign.status).toBe(404);
    const eveList = await call(world.server, eve, "GET", tokensPath);
    expect(eveList.body.tokens).toEqual([]);
    expect((await call(world.server, own.auth, "GET", tokensPath)).status).toBe(401);
    const revoked = await call(world.server, ada, "DELETE", `${tokensPath}/${own.id}`);
    expect((revoked.body.token as { revokedAt: string }).revokedAt).toEqual(expect.any(String));
    const again = await call(world.server, ada, "DELETE", `${tokensPath}/${own.id}`);
    expect(again.body.token).toEqual(revoked.body.token);
    const [row] = await world.db.sql`select revoked_at from api_tokens where id = ${own.id}`;
    expect(row?.revoked_at).toBeInstanceOf(Date);
  });
});

describe("server configuration", () => {
  it("leaves the MCP address to the web app when MCP_PUBLIC_URL is not set", async () => {
    const plain = await newServer(world.db, { setupToken: null });
    const nina = await seedUser(world.db, "nina");
    const auth = { session: await signIn(plain, nina.email) };
    await reauthenticated(plain, auth);
    const response = await call(plain, auth, "POST", tokensPath, {
      name: "plain",
      mode: "deny_list",
      basePermissions: ["read"],
    });
    expect(response.body.mcp).toEqual({ serverName: "hexmark", url: null, config: null });
  });

  it("refuses tokens while SETUP_TOKEN is set, like sign-ins", async () => {
    const token = await apiToken(world, ada, { name: "blocked", permissions: ["read"] });
    const blocked = await newServer(world.db);
    const response = await call(blocked, token.auth, "GET", "/api/notes/v1/tree");
    expect(response).toMatchObject({ status: 403, body: { error: "setup_token_present" } });
    const working = await call(world.server, token.auth, "GET", "/api/notes/v1/tree");
    expect(working.status).toBe(200);
  });
});
