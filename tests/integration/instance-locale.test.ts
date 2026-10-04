import { describe, expect, it } from "vitest";
import {
  adminInput,
  getJson,
  newDatabase,
  newServer,
  pgServer,
  postJson,
  unreachablePort,
} from "./harness";

// GET /api/instance/v1/locale: the instance default locale the web app uses
// for visitors without a saved or chosen locale.

const PATH = "/api/instance/v1/locale";

describe("GET /api/instance/v1/locale", () => {
  it("is null before setup and the chosen locale after it", async () => {
    const server = await newServer(await newDatabase());
    expect(await getJson(server, PATH)).toEqual({ status: 200, body: { defaultLocale: null } });
    const created = await postJson(server, "/api/setup/v1/create-first-admin", adminInput());
    expect(created.status).toBe(201);
    expect(await getJson(server, PATH)).toEqual({ status: 200, body: { defaultLocale: "de" } });
  });

  it("answers 503 while the database is not reachable", async () => {
    const pg = pgServer();
    const server = await newServer(undefined, {
      waitForDatabase: false,
      databaseEnv: {
        POSTGRES_USER: pg.user,
        POSTGRES_PASSWORD: pg.password,
        POSTGRES_DB: "postgres",
        DB_HOST: "127.0.0.1",
        DB_PORT: String(await unreachablePort()),
      },
    });
    expect(await getJson(server, PATH)).toEqual({
      status: 503,
      body: { error: "database_unavailable" },
    });
  });
});
