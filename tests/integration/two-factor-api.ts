import { base32Decode, hotp, totpStep } from "../../apps/server/src/services/totp";
import type { TestDatabase } from "../support/databases";
import type { HexmarkServer } from "../support/hexmark-server";
import { newCredential, register, type SoftCredential } from "../support/soft-authenticator";
import { PASSWORD } from "./auth-harness";
import { type JsonResponse, newServer } from "./harness";

// Helpers for the second-factor tests: requests with a session or a
// challenge, codes from an authenticator app, and keys from the software
// authenticator (tests/support/soft-authenticator.ts).

// The origin the test servers accept WebAuthn answers from.
export const ORIGIN = "http://localhost:3000";

export function twoFactorServer(db: TestDatabase, env: Record<string, string> = {}) {
  return newServer(db, { setupToken: null, env: { PUBLIC_ORIGIN: ORIGIN, ...env } });
}

export interface Auth {
  session?: string;
  challenge?: string;
}

export async function call(
  server: HexmarkServer,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  auth: Auth = {},
  body?: unknown,
): Promise<JsonResponse> {
  const headers: Record<string, string> = { "user-agent": "integration-test" };
  if (auth.session) headers.authorization = `Session ${auth.session}`;
  if (auth.challenge) headers.authorization = `Challenge ${auth.challenge}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${server.url}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

export async function reauthenticate(server: HexmarkServer, session: string): Promise<void> {
  const response = await call(
    server,
    "POST",
    "/auth/v1/reauthenticate",
    { session },
    {
      password: PASSWORD,
    },
  );
  if (response.status !== 200) throw new Error(`reauthenticate: ${JSON.stringify(response)}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits (at most ~2 s) until the current 30-second step has at least 2 s
// left, so a code computed here is still current or ±1 when the server
// checks it.
export async function awayFromStepEdge(): Promise<void> {
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 2_000) await sleep(left + 50);
}

// The app's code `offset` steps from now.
export function totp(secretBase32: string, offset = 0): string {
  const secret = base32Decode(secretBase32);
  if (!secret) throw new Error("not base32");
  return hotp(secret, totpStep(new Date()) + offset);
}

export interface EnabledTotp {
  secret: string;
  recoveryCodes: string[] | null;
}

// Sets up the authenticator app through `prefix` (/account/v1,
// /setup/v1/two-factor, /auth/v1/enrolment) and returns its secret.
export async function enableTotp(
  server: HexmarkServer,
  auth: Auth,
  prefix = "/account/v1",
): Promise<EnabledTotp & { confirm: JsonResponse }> {
  const start = await call(server, "POST", `${prefix}/totp/start`, auth);
  if (start.status !== 200) throw new Error(`totp/start: ${JSON.stringify(start)}`);
  const secret = start.body.secret as string;
  await awayFromStepEdge();
  const confirm = await call(server, "POST", `${prefix}/totp/confirm`, auth, {
    code: totp(secret),
  });
  if (confirm.status !== 200) throw new Error(`totp/confirm: ${JSON.stringify(confirm)}`);
  return { secret, recoveryCodes: confirm.body.recoveryCodes as string[] | null, confirm };
}

// Registers a software key through `prefix` and returns it with the answer.
export async function addKey(
  server: HexmarkServer,
  auth: Auth,
  name = "Desk key",
  prefix = "/account/v1",
): Promise<{ key: SoftCredential; verify: JsonResponse }> {
  const options = await call(server, "POST", `${prefix}/webauthn/registration/options`, auth);
  if (options.status !== 200) throw new Error(`options: ${JSON.stringify(options)}`);
  const key = newCredential();
  const response = register(key, options.body.options as never, ORIGIN);
  const verify = await call(server, "POST", `${prefix}/webauthn/registration/verify`, auth, {
    name,
    response,
  });
  return { key, verify };
}

export async function setRequireTwoFactor(db: TestDatabase, value: boolean): Promise<void> {
  await db.sql`
    insert into instance_settings (id, require_two_factor) values (1, ${value})
    on conflict (id) do update set require_two_factor = ${value}
  `;
}

// Lets the next code of the same step count as fresh again (replay
// protection reset), so tests do not have to wait for the next step.
export async function forgetLastTotpStep(db: TestDatabase, userId: string): Promise<void> {
  await db.sql`update totp_credentials set last_used_step = null where user_id = ${userId}`;
}

export async function rows(db: TestDatabase, table: string, userId: string) {
  return db.sql`select * from ${db.sql(table)} where user_id = ${userId} order by created_at`;
}

// expires_at - created_at of the challenge a token belongs to, in ms.
export async function challengeLifetime(db: TestDatabase, tokenHash: string): Promise<number> {
  const [row] = await db.sql`
    select (extract(epoch from expires_at - created_at) * 1000)::int as ms
    from auth_challenges where token_hash = ${tokenHash}
  `;
  if (!row) throw new Error("no challenge for this token");
  return row.ms as number;
}
