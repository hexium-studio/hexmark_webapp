import type { TestDatabase } from "../support/databases";
import type { HexmarkServer, ServerOptions } from "../support/hexmark-server";
import { PASSWORD, seedUser, signIn } from "./auth-harness";
import { type JsonResponse, newDatabase, newServer } from "./harness";
import { migrate } from "./migrations";

// Helpers for the tests of /api/notes/v1, /api/tokens/v1 and /mcp: a server
// that accepts sign-ins (no SETUP_TOKEN), users per role with a session, API
// tokens created through the API, and requests as session or bearer.

export interface NotesWorld {
  db: TestDatabase;
  server: HexmarkServer;
}

export async function notesWorld(
  env: Record<string, string> = {},
  options: Omit<ServerOptions, "mode" | "database"> = {},
): Promise<NotesWorld> {
  const db = await newDatabase();
  await migrate(db);
  const server = await newServer(db, { setupToken: null, env, ...options });
  return { db, server };
}

export type Auth = { session: string } | { bearer: string };

export function authHeader(auth: Auth): string {
  return "session" in auth ? `Session ${auth.session}` : `Bearer ${auth.bearer}`;
}

export async function call(
  server: HexmarkServer,
  auth: Auth | null,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<JsonResponse> {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = authHeader(auth);
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

// Re-enters the password in the session, as creating a token requires.
export async function reauthenticated(server: HexmarkServer, auth: Auth): Promise<void> {
  const response = await call(server, auth, "POST", "/api/auth/v1/reauthenticate", {
    password: PASSWORD,
  });
  if (response.status !== 200) throw new Error(`reauthenticate: ${JSON.stringify(response)}`);
}

// A signed-in user with the given role; returns the session auth and the id.
// The password counts as re-entered (`fresh`), so tokens can be created.
export async function signedIn(
  world: NotesWorld,
  username: string,
  role: "admin" | "user" | "guest" = "user",
  fresh = true,
): Promise<{ auth: Auth; id: string }> {
  const user = await seedUser(world.db, username);
  if (role !== "user") await world.db.sql`update users set role = ${role} where id = ${user.id}`;
  const auth = { session: await signIn(world.server, user.email) };
  if (fresh) await reauthenticated(world.server, auth);
  return { auth, id: user.id };
}

// Creates an API token through the API; returns its bearer auth and id.
export async function apiToken(
  world: NotesWorld,
  owner: Auth,
  input: Record<string, unknown>,
): Promise<{ auth: Auth; id: string; token: string }> {
  const response = await call(world.server, owner, "POST", "/api/tokens/v1/tokens", input);
  if (response.status !== 201) throw new Error(`token not created: ${JSON.stringify(response)}`);
  const token = response.body.token as string;
  const info = response.body.info as { id: string };
  return { auth: { bearer: token }, id: info.id, token };
}

export const notesApi = "/api/notes/v1";

// Creates a note and returns its id (fails the test otherwise).
export async function createNote(
  world: NotesWorld,
  auth: Auth,
  input: Record<string, unknown>,
): Promise<string> {
  const response = await call(world.server, auth, "POST", `${notesApi}/notes`, input);
  if (response.status !== 201) throw new Error(`note not created: ${JSON.stringify(response)}`);
  return response.body.id as string;
}

export async function createFolder(
  world: NotesWorld,
  auth: Auth,
  name: string,
  parentId: string | null = null,
): Promise<string> {
  const response = await call(world.server, auth, "POST", `${notesApi}/folders`, {
    name,
    parentId,
  });
  if (response.status !== 201) throw new Error(`folder not created: ${JSON.stringify(response)}`);
  return response.body.id as string;
}

// The revisions of a note as stored: version, change, actor name and ids.
export async function revisionRows(db: TestDatabase, noteId: string) {
  return db.sql`
    select version, change, reason, actor_name, actor_user_id, actor_token_id
    from note_revisions where note_id = ${noteId} order by version
  `;
}
