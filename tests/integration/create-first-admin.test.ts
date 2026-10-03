import { verify } from "@node-rs/argon2";
import { describe, expect, it } from "vitest";
import { adminInput, getJson, newDatabase, newServer, postJson } from "./harness";

// POST /api/setup/v1/create-first-admin and what it stores.

const PATH = "/api/setup/v1/create-first-admin";

describe("validation", () => {
  it.each([
    ["displayName", { displayName: "   " }, { code: "required" }],
    ["displayName", { displayName: "x".repeat(65) }, { code: "too_long", params: { max: 64 } }],
    ["displayName", { displayName: 42 }, { code: "invalid_type" }],
    ["username", { username: "ab" }, { code: "too_short", params: { min: 3 } }],
    ["username", { username: "a".repeat(33) }, { code: "too_long", params: { max: 32 } }],
    ["username", { username: "-ada" }, { code: "invalid_format" }],
    ["username", { username: undefined }, { code: "required" }],
    ["email", { email: " " }, { code: "required" }],
    ["email", { email: "not-an-address" }, { code: "invalid_email" }],
    ["email", { email: `${"a".repeat(250)}@x.de` }, { code: "too_long", params: { max: 254 } }],
    [
      "password",
      { password: "short", passwordConfirm: "short" },
      { code: "too_short", params: { min: 12 } },
    ],
    [
      "password",
      { password: "p".repeat(129), passwordConfirm: "p".repeat(129) },
      { code: "too_long", params: { max: 128 } },
    ],
    ["passwordConfirm", { passwordConfirm: "" }, { code: "required" }],
    ["passwordConfirm", { passwordConfirm: "something else!" }, { code: "mismatch" }],
    ["locale", { locale: "DE" }, { code: "invalid_option" }],
    ["locale", { locale: null }, { code: "required" }],
    ["setupToken", { setupToken: "abc" }, { code: "invalid_format", params: { length: 8 } }],
  ])("400 for %s %j", async (field, overrides, error) => {
    const server = await sharedServer();
    const response = await postJson(server, PATH, adminInput(overrides));
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "validation", fields: { [field]: error } });
  });

  it("reports every invalid field at once, the first problem per field", async () => {
    const server = await sharedServer();
    const response = await postJson(server, PATH, { setupToken: "TEST2345" });
    expect(response.body.fields).toEqual({
      displayName: { code: "required" },
      username: { code: "required" },
      email: { code: "required" },
      password: { code: "required" },
      passwordConfirm: { code: "required" },
      locale: { code: "required" },
    });
  });

  it("401 for a wrong token with otherwise valid input", async () => {
    const server = await sharedServer();
    const response = await postJson(server, PATH, adminInput({ setupToken: "WRONG234" }));
    expect(response).toEqual({ status: 401, body: { error: "invalid_token" } });
  });
});

let shared: Awaited<ReturnType<typeof newServer>> | undefined;
async function sharedServer() {
  shared ??= await newServer(await newDatabase());
  return shared;
}

describe("creating the admin", () => {
  it("stores the normalised account, its locale and the instance default", async () => {
    const db = await newDatabase();
    const server = await newServer(db);
    expect((await getJson(server, "/api/instance/v1/locale")).body).toEqual({
      defaultLocale: null,
    });

    const input = adminInput({
      displayName: "  Ada Lovelace ",
      username: " Ada_Admin ",
      email: "  Ada@Example.COM ",
      setupToken: " test2345 ",
      locale: "pt-BR",
    });
    expect(await postJson(server, PATH, input)).toEqual({
      status: 201,
      body: { ok: true, ticket: { token: expect.any(String), expiresAt: expect.any(String) } },
    });

    const users = await db.sql`select * from users`;
    expect(users).toHaveLength(1);
    const [user] = users;
    expect(user).toMatchObject({
      display_name: "Ada Lovelace",
      username: "ada_admin",
      email: "ada@example.com",
      role: "admin",
      locale: "pt-BR",
    });
    expect(user?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verify(String(user?.password_hash), String(input.password))).toBe(true);
    expect(await verify(String(user?.password_hash), "wrong password!")).toBe(false);

    const settings = await db.sql`select id, default_locale from instance_settings`;
    expect(settings).toEqual([{ id: 1, default_locale: "pt-BR" }]);
    expect((await getJson(server, "/api/instance/v1/locale")).body).toEqual({
      defaultLocale: "pt-BR",
    });
    const status = await getJson(server, "/api/setup/v1/status");
    expect(status.body).toMatchObject({ setupOpen: false });

    const again = await postJson(
      server,
      PATH,
      adminInput({ username: "other", email: "o@example.com" }),
    );
    expect(again).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await db.sql`select count(*)::int as n from users`).toEqual([{ n: 1 }]);
  });

  it("creates exactly one admin when requests race", async () => {
    const db = await newDatabase();
    const server = await newServer(db);
    // Five is the per-address attempt limit; every request below counts
    // until it is decided.
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        postJson(
          server,
          PATH,
          adminInput({ username: `admin${index}`, email: `admin${index}@example.com` }),
        ),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 404, 404, 404, 404]);
    expect(await db.sql`select count(*)::int as n from users`).toEqual([{ n: 1 }]);
    expect(await db.sql`select count(*)::int as n from instance_settings`).toEqual([{ n: 1 }]);
  });
});
