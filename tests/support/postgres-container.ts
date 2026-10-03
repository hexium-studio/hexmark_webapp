import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { REPO_ROOT } from "./paths";
import { type ManagedProcess, startProcess, waitFor } from "./processes";

// A throwaway PostgreSQL 18 container for one test run, on a random free
// port of 127.0.0.1. Data lives in a tmpfs, so nothing is written to a
// Docker volume. Containers carry the label hexmark.tests; the developer's
// own stack (compose.dev.yaml) is never touched.

export const POSTGRES_IMAGE = "postgres:18-alpine";
const LABEL = "hexmark.tests";

export interface PgServer {
  host: string;
  port: number;
  user: string;
  password: string;
  // Maintenance database used to create and drop the per-test databases.
  adminDatabase: string;
  container: string;
}

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Removes test containers whose test run is gone (e.g. killed with SIGKILL
// before its guard could act). Containers of runs still alive are kept.
export function removeStaleContainers(): void {
  const lines = docker([
    "ps",
    "-a",
    "--filter",
    `label=${LABEL}`,
    "--format",
    `{{.ID}} {{.Label "${LABEL}.owner"}}`,
  ]);
  for (const line of lines.split("\n").filter(Boolean)) {
    const [id = "", owner = ""] = line.split(" ");
    if (!pidAlive(Number(owner))) docker(["rm", "-f", id]);
  }
}

export interface StartedPg {
  server: PgServer;
  stop(): Promise<void>;
}

export async function startPostgres(purpose: string): Promise<StartedPg> {
  try {
    docker(["info", "--format", "{{.ServerVersion}}"]);
  } catch {
    throw new Error("Docker is not running; the integration and e2e tests need it.");
  }
  removeStaleContainers();
  const container = `hexmark-tests-${purpose}-${process.pid}-${randomBytes(3).toString("hex")}`;
  const user = "hexmark_test";
  const password = randomBytes(12).toString("hex");
  const runArgs = [
    "run",
    "--rm",
    "--name",
    container,
    "--label",
    LABEL,
    "--label",
    `${LABEL}.owner=${process.pid}`,
    "--publish",
    "127.0.0.1::5432",
    "--tmpfs",
    "/var/lib/postgresql",
    "--env",
    `POSTGRES_USER=${user}`,
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    "--env",
    "POSTGRES_DB=postgres",
    POSTGRES_IMAGE,
    // Durability is pointless for throwaway data; this makes tests faster.
    ...["-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off"],
    // Integration test files run in parallel, each with API server processes
    // of its own (a pool of up to 10 connections each) plus test clients:
    // a full run reaches ~90 connections, the default limit is 100. Beyond
    // it, servers and queries are refused ("too many clients") and many
    // tests of one run fail at once.
    ...["-c", "max_connections=300"],
  ];
  const proc: ManagedProcess = startProcess({
    name: `postgres-${purpose}`,
    command: "docker",
    args: runArgs,
    cwd: REPO_ROOT,
    env: process.env,
    cleanup: ["docker", "rm", "-f", container],
  });
  let port = 0;
  await waitFor(
    "the PostgreSQL container's port",
    async () => {
      const mapping = docker(["port", container, "5432/tcp"]).trim().split("\n")[0] ?? "";
      port = Number(mapping.split(":").pop());
      return port > 0;
    },
    proc,
  );
  const server: PgServer = {
    host: "127.0.0.1",
    port,
    user,
    password,
    adminDatabase: "postgres",
    container,
  };
  // The image's init phase listens on a Unix socket only, so a TCP answer
  // means the final server is up.
  await waitFor(
    "PostgreSQL to accept connections",
    async () => {
      const sql = adminClient(server);
      try {
        await sql`select 1`;
        return true;
      } finally {
        await sql.end({ timeout: 1 });
      }
    },
    proc,
  );
  return {
    server,
    async stop() {
      await proc.stop();
      try {
        docker(["rm", "-f", container]);
      } catch {
        // already removed by --rm or the guard
      }
    },
  };
}

export function adminClient(server: PgServer, database = server.adminDatabase) {
  return postgres({
    host: server.host,
    port: server.port,
    user: server.user,
    password: server.password,
    database,
    max: 2,
    connect_timeout: 5,
    onnotice: () => {},
  });
}
