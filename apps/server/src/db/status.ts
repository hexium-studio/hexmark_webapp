// Database state as seen by the background migration loop (src/db/migrate.ts).
// Read by endpoints such as the setup status; nothing here touches the database.

export interface DbStatus {
  // The last connection attempt succeeded.
  reachable: boolean;
  // All migrations have been applied; tables may be used only when true.
  migrated: boolean;
  // Short, generic reason for the last failure (see classifyDbError); never
  // contains connection settings or driver details.
  reason?: string;
}

let status: DbStatus = { reachable: false, migrated: false, reason: "not checked yet" };

export function getDbStatus(): DbStatus {
  return { ...status };
}

export function setDbStatus(next: DbStatus): void {
  status = next;
}

// Maps a driver or migrator error to a short, generic reason.
export function classifyDbError(error: unknown, stage: "connect" | "migrate"): string {
  if (stage === "migrate") return "migration failed";
  let current: unknown = error;
  while (current instanceof Error && current.cause !== undefined) current = current.cause;
  const code = (current as { code?: unknown } | undefined)?.code;
  switch (code) {
    case "ECONNREFUSED":
      return "connection refused";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "host not found";
    case "ETIMEDOUT":
    case "CONNECT_TIMEOUT":
      return "connection timed out";
    case "28P01":
    case "28000":
      return "authentication failed";
    case "3D000":
      return "database does not exist";
    default:
      return "database unreachable";
  }
}
