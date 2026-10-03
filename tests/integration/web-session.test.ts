import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchMe } from "../../apps/web/src/lib/session/me";
import type { TestDatabase } from "../support/databases";
import type { HexmarkServer } from "../support/hexmark-server";
import { age, type SeededUser, seedUser, signIn } from "./auth-harness";
import { newDatabase, newServer } from "./harness";
import { migrate } from "./migrations";

// The web server's side of the session check (apps/web/src/lib/session/me.ts),
// the call the request proxy makes before every page, against a real API
// server: what it reports for a fresh, a rotated, an ended and an
// unreachable session.

let db: TestDatabase;
let server: HexmarkServer;
let ada: SeededUser;
const previousUrl = process.env.SERVER_INTERNAL_URL;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  ada = await seedUser(db, "ada");
  server = await newServer(db, { setupToken: null, env: { SESSION_ROTATION: "1m" } });
  process.env.SERVER_INTERNAL_URL = server.url;
  return () => {
    process.env.SERVER_INTERNAL_URL = previousUrl;
  };
});

afterEach(() => {
  process.env.SERVER_INTERNAL_URL = server.url;
});

describe("fetchMe", () => {
  it("valid: the user and the session, no new token while rotation is not due", async () => {
    const token = await signIn(server, ada.email, true);
    const result = await fetchMe(token);
    expect(result).toEqual({
      kind: "valid",
      user: { id: ada.id, displayName: "ada Display", username: "ada", role: "user", locale: "de" },
      expiresAt: expect.any(String),
      remember: true,
    });
  });

  it("rotation due: a new token, which works while the old one is in its grace period", async () => {
    const token = await signIn(server, ada.email);
    await age(db, token, "rotated_at", "2 minutes");
    const rotated = await fetchMe(token);
    expect(rotated).toMatchObject({ kind: "valid", remember: false });
    const next = rotated.kind === "valid" ? rotated.rotatedToken : undefined;
    expect(next).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(next).not.toBe(token);
    expect(await fetchMe(next ?? "")).toMatchObject({ kind: "valid" });
    expect(await fetchMe(next ?? "")).not.toHaveProperty("rotatedToken");
    // A parallel request with the old token: still valid, no second rotation.
    const old = await fetchMe(token);
    expect(old).toMatchObject({ kind: "valid" });
    expect(old).not.toHaveProperty("rotatedToken");
  });

  it("invalid: an unknown token or an idle session without remember me", async () => {
    expect(await fetchMe("A".repeat(43))).toEqual({ kind: "invalid" });
    const token = await signIn(server, ada.email);
    await age(db, token, "last_seen_at", "61 minutes");
    expect(await fetchMe(token)).toEqual({ kind: "invalid" });
  });

  it("unavailable when nobody answers, so the cookie is kept", async () => {
    process.env.SERVER_INTERNAL_URL = "http://127.0.0.1:9";
    expect(await fetchMe("A".repeat(43))).toEqual({ kind: "unavailable" });
  });
});
