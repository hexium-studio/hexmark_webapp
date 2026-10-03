import { afterAll, inject } from "vitest";
import { createDatabase, type TestDatabase } from "../support/databases";
import {
  type HexmarkServer,
  type ServerOptions,
  startHexmarkServer,
  TEST_SETUP_TOKEN,
} from "../support/hexmark-server";

// Per-file helpers: an own database in the shared container and API server
// processes started from source, all stopped and dropped after the file.

export function pgServer() {
  return inject("pg");
}

const cleanups: (() => Promise<void>)[] = [];

afterAll(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

export async function newDatabase(prefix = "it"): Promise<TestDatabase> {
  const db = await createDatabase(pgServer(), prefix);
  cleanups.push(() => db.drop());
  return db;
}

// Stopped after the file; call stop() earlier to restart with fresh state.
export async function newServer(
  db: TestDatabase | undefined,
  options: Omit<ServerOptions, "mode" | "database"> = {},
): Promise<HexmarkServer> {
  const server = await startHexmarkServer({
    mode: "source",
    database: db ? { server: db.server, name: db.name } : undefined,
    ...options,
  });
  cleanups.push(() => server.stop());
  return server;
}

export interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

export async function getJson(server: HexmarkServer, path: string): Promise<JsonResponse> {
  const response = await fetch(`${server.url}${path}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

export async function postJson(
  server: HexmarkServer,
  path: string,
  body: unknown,
): Promise<JsonResponse> {
  const response = await fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

// A complete, valid body for POST /api/setup/v1/create-first-admin.
export function adminInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    displayName: "Ada Admin",
    username: "ada",
    email: "ada@example.com",
    password: "correct horse battery",
    passwordConfirm: "correct horse battery",
    setupToken: TEST_SETUP_TOKEN,
    locale: "de",
    ...overrides,
  };
}
