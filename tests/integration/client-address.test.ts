import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import {
  type HexmarkServer,
  TEST_INTERNAL_API_KEY,
  TEST_SETUP_TOKEN,
} from "../support/hexmark-server";
import { PASSWORD, type SeededUser, seedUser, sessionCount } from "./auth-harness";
import { type JsonResponse, newDatabase, newServer } from "./harness";
import { migrate } from "./migrations";

// Which address the API server attributes a request to
// (apps/server/src/services/client-address.ts): the forwarded browser
// address only with the right internal key, else the connection's address.
// Checked through the per-address rate limits of sign-in (10 failures) and
// setup (5 wrong tokens). Each test starts its own server, so its counters
// start at zero.

const LOGIN = "/api/auth/v1/login";
const VERIFY = "/api/setup/v1/verify-token";
const CLIENT_A = "203.0.113.10";
const CLIENT_B = "198.51.100.20";
const WRONG_KEY = Buffer.alloc(32, 0x99).toString("base64url");

let db: TestDatabase;
let ada: SeededUser;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  ada = await seedUser(db, "ada");
});

function as(clientIp: string, key: string | null): Record<string, string> {
  return {
    "x-hexmark-client-ip": clientIp,
    ...(key === null ? {} : { "x-hexmark-internal-key": key }),
  };
}

async function post(
  server: HexmarkServer,
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<JsonResponse> {
  const response = await fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const wrongLogin = { email: "ada@example.com", password: "wrong password", remember: false };

// Status codes of `count` failed sign-ins.
async function failLogins(server: HexmarkServer, count: number, headers: Record<string, string>) {
  const statuses: number[] = [];
  for (let i = 0; i < count; i++)
    statuses.push((await post(server, LOGIN, wrongLogin, headers)).status);
  return statuses;
}

describe("sign-in rate limit per forwarded address", () => {
  it("with the internal key: one client's lockout does not lock another", async () => {
    const server = await newServer(db, { setupToken: null });
    const before = await sessionCount(db);
    expect(await failLogins(server, 10, as(CLIENT_A, TEST_INTERNAL_API_KEY))).toEqual(
      Array(10).fill(401),
    );
    // A is locked out now, also with the right password.
    const lockedA = await post(
      server,
      LOGIN,
      { ...wrongLogin, password: PASSWORD },
      as(CLIENT_A, TEST_INTERNAL_API_KEY),
    );
    expect(lockedA).toEqual({ status: 429, body: { error: "rate_limited" } });
    // B still gets a normal answer and can sign in.
    expect(
      (await post(server, LOGIN, wrongLogin, as(CLIENT_B, TEST_INTERNAL_API_KEY))).status,
    ).toBe(401);
    const signedIn = await post(
      server,
      LOGIN,
      { email: ada.email, password: PASSWORD, remember: false },
      as(CLIENT_B, TEST_INTERNAL_API_KEY),
    );
    expect(signedIn.status).toBe(200);
    expect(await sessionCount(db)).toBe(before + 1);
    // A direct caller (the test process, no forwarded address) is a third address.
    expect((await post(server, LOGIN, wrongLogin, {})).status).toBe(401);
  });

  it.each([
    ["a wrong key", WRONG_KEY],
    ["no key", null],
    ["an empty key", ""],
  ])(
    "with %s the forwarded address is ignored: all share the connection's address",
    async (_, key) => {
      const server = await newServer(db, { setupToken: null });
      expect(await failLogins(server, 10, as(CLIENT_A, key))).toEqual(Array(10).fill(401));
      // "Another" client with the same wrong key: counted on the same address.
      const other = await post(server, LOGIN, wrongLogin, as(CLIENT_B, key));
      expect(other).toEqual({ status: 429, body: { error: "rate_limited" } });
      // So is the caller without any forwarding header.
      expect((await post(server, LOGIN, wrongLogin, {})).status).toBe(429);
      // The web server with the right key is not affected.
      expect(
        (await post(server, LOGIN, wrongLogin, as(CLIENT_B, TEST_INTERNAL_API_KEY))).status,
      ).toBe(401);
    },
  );

  it("an unparseable forwarded address falls back to the connection's address", async () => {
    const server = await newServer(db, { setupToken: null });
    expect(await failLogins(server, 10, as("not-an-ip", TEST_INTERNAL_API_KEY))).toEqual(
      Array(10).fill(401),
    );
    expect((await post(server, LOGIN, wrongLogin, {})).status).toBe(429);
  });

  it("IPv4-mapped and plain IPv4 count as one client", async () => {
    const server = await newServer(db, { setupToken: null });
    await failLogins(server, 5, as(CLIENT_A, TEST_INTERNAL_API_KEY));
    await failLogins(server, 5, as(`::ffff:${CLIENT_A}`, TEST_INTERNAL_API_KEY));
    expect(
      (await post(server, LOGIN, wrongLogin, as(CLIENT_A, TEST_INTERNAL_API_KEY))).status,
    ).toBe(429);
  });
});

describe("setup token rate limit per forwarded address", () => {
  it("five wrong tokens lock one client, not another", async () => {
    const setupDb = await newDatabase("it-setup");
    const server = await newServer(setupDb);
    const wrong = { setupToken: "WRONG234" };
    for (let i = 0; i < 5; i++) {
      expect((await post(server, VERIFY, wrong, as(CLIENT_A, TEST_INTERNAL_API_KEY))).status).toBe(
        401,
      );
    }
    expect((await post(server, VERIFY, wrong, as(CLIENT_A, TEST_INTERNAL_API_KEY))).status).toBe(
      429,
    );
    const right = await post(
      server,
      VERIFY,
      { setupToken: TEST_SETUP_TOKEN },
      as(CLIENT_B, TEST_INTERNAL_API_KEY),
    );
    expect(right).toEqual({ status: 200, body: { ok: true } });
  });
});
