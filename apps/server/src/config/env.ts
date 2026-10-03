import { setupTokenSchema } from "@hexmark/shared";
import { DEFAULT_DB_HOST, DEFAULT_DB_PORT } from "./database";

// Reads server configuration from the environment once, at start-up.
// Docker Compose passes the variables listed in compose.yaml; `pnpm dev`
// loads the repository root .env (apps/server/package.json).

const DEFAULT_PORT = 3001;

// Undefined for a blank value, null for an invalid one.
function parsePort(raw: string | undefined): number | null | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function readPort(raw: string | undefined): number {
  const port = parsePort(raw);
  if (port === null) {
    throw new Error(`PORT must be a whole number between 1 and 65535, got "${raw}".`);
  }
  return port ?? DEFAULT_PORT;
}

// Option names shared by postgres.js and drizzle-kit, so no connection URL
// has to be built (and no password escaped).
export interface DatabaseConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export type DatabaseConfig =
  | { configured: true; connection: DatabaseConnection }
  // `reason` is short and generic (shown as the database status); `problem`
  // names the variables for the log. Neither contains a value.
  | { configured: false; reason: string; problem: string };

const CREDENTIAL_VARIABLES = ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"] as const;

// A missing or invalid setting does not stop the server: it reports the
// database as not configured (src/db/migrate.ts) and keeps answering.
export function readDatabaseConfig(source: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const missing = CREDENTIAL_VARIABLES.filter((name) => !source[name]?.trim());
  if (missing.length > 0) {
    return {
      configured: false,
      reason: "database credentials are not set",
      problem: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set`,
    };
  }
  const port = parsePort(source.DB_PORT);
  if (port === null) {
    return {
      configured: false,
      reason: "database port is invalid",
      problem: "DB_PORT must be a whole number between 1 and 65535",
    };
  }
  return {
    configured: true,
    connection: {
      host: source.DB_HOST?.trim() || DEFAULT_DB_HOST,
      port: port ?? DEFAULT_DB_PORT,
      // Passed as set: the PostgreSQL container uses the same raw values.
      user: source.POSTGRES_USER as string,
      password: source.POSTGRES_PASSWORD as string,
      database: source.POSTGRES_DB as string,
    },
  };
}

export interface SetupTokenConfig {
  // SETUP_TOKEN is set to a non-blank value.
  present: boolean;
  // Normalised token (trimmed, upper-cased) when the format is valid, else null.
  // Never log this value.
  value: string | null;
}

// An invalid SETUP_TOKEN does not stop the server: the setup wizard reports
// it and setup cannot complete (src/api/setup/_lib/setup-token.ts).
function readSetupToken(raw: string | undefined): SetupTokenConfig {
  if (raw === undefined || raw.trim() === "") return { present: false, value: null };
  const parsed = setupTokenSchema.safeParse(raw);
  return { present: true, value: parsed.success ? parsed.data : null };
}

export const env = {
  port: readPort(process.env.PORT),
  database: readDatabaseConfig(),
  setupToken: readSetupToken(process.env.SETUP_TOKEN),
};
