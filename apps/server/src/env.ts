// Reads server configuration from the environment.
// SETUP_TOKEN is documented in .env.example but not read yet.

const DEFAULT_PORT = 3001;

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number between 1 and 65535, got "${raw}".`);
  }
  return port;
}

export const env = {
  port: readPort(process.env.PORT),
  databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
};
