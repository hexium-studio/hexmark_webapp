import { createHash } from "node:crypto";
import { hashPassword } from "../../apps/server/src/services/password";
import type { TestDatabase } from "../support/databases";
import type { HexmarkServer } from "../support/hexmark-server";
import type { JsonResponse } from "./harness";

// Helpers for the /api/auth/v1 tests: accounts with real password hashes,
// requests as the web server sends them, and the stored form of a token.

export const PASSWORD = "correct horse battery";

export interface SeededUser {
  id: string;
  email: string;
}

export async function seedUser(db: TestDatabase, username: string): Promise<SeededUser> {
  const email = `${username}@example.com`;
  const passwordHash = await hashPassword(PASSWORD);
  const [row] = await db.sql`
    insert into users (email, username, display_name, password_hash, role, locale)
    values (${email}, ${username}, ${`${username} Display`}, ${passwordHash}, 'user', 'de')
    returning id
  `;
  return { id: row?.id as string, email };
}

async function send(
  server: HexmarkServer,
  method: "GET" | "POST",
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<JsonResponse> {
  const response = await fetch(`${server.url}/api/auth/v1${path}`, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

export function login(
  server: HexmarkServer,
  body: unknown,
  userAgent = "integration-test",
): Promise<JsonResponse> {
  return send(server, "POST", "/login", { "user-agent": userAgent }, body);
}

// Signs in and returns the token; fails the test when sign-in fails.
export async function signIn(
  server: HexmarkServer,
  email: string,
  remember = false,
): Promise<string> {
  const response = await login(server, { email, password: PASSWORD, remember });
  const session = response.body.session as { token?: string } | undefined;
  if (response.status !== 200 || !session?.token) {
    throw new Error(`sign-in failed: ${JSON.stringify(response)}`);
  }
  return session.token;
}

export function me(server: HexmarkServer, token: string): Promise<JsonResponse> {
  return send(server, "GET", "/me", { authorization: `Session ${token}` });
}

export function logout(server: HexmarkServer, token: string): Promise<JsonResponse> {
  return send(server, "POST", "/logout", { authorization: `Session ${token}` });
}

export function sha256Hex(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// The session row of a token (current or previous), for assertions.
export async function sessionRow(
  db: TestDatabase,
  token: string,
): Promise<Record<string, unknown>> {
  const hash = sha256Hex(token);
  const [row] = await db.sql`
    select * from sessions where token_hash = ${hash} or previous_token_hash = ${hash}
  `;
  if (!row) throw new Error("no session row for this token");
  return row;
}

// Moves a timestamp of the session of `token` into the past
// (`now() - interval`), so time-based rules can be tested without waiting.
export async function age(
  db: TestDatabase,
  token: string,
  column: string,
  interval: string,
): Promise<void> {
  await db.sql.unsafe(
    `update sessions set ${column} = now() - $2::interval where token_hash = $1`,
    [sha256Hex(token), interval],
  );
}

export async function sessionCount(db: TestDatabase): Promise<number> {
  const [row] = await db.sql`select count(*)::int as n from sessions`;
  return row?.n as number;
}
