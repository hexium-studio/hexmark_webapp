import { type SetupStatus, setupStatusSchema } from "@hexmark/shared";
import { callServer } from "./server-api";

// Loads GET /api/setup/v1/status for the setup routes (/setup, /setup/complete).

// Part of the 503 body the server sends while the database is not ready.
const databaseUnavailableSchema = setupStatusSchema.pick({
  database: true,
  setupTokenConfigured: true,
  secretsConfigured: true,
});

export type SetupStatusResult =
  | { kind: "ok"; status: SetupStatus }
  // The server answered, but cannot tell whether setup is open yet.
  | {
      kind: "database_unavailable";
      database: SetupStatus["database"];
      setupTokenConfigured: boolean;
      secretsConfigured: boolean;
    }
  | { kind: "server_unreachable" }
  // The server answered with something this app does not understand.
  | { kind: "unexpected_response"; httpStatus: number };

export async function loadSetupStatus(): Promise<SetupStatusResult> {
  const response = await callServer("/api/setup/v1/status");
  if (!response.reachable) return { kind: "server_unreachable" };
  if (response.status === 200) {
    const parsed = setupStatusSchema.safeParse(response.body);
    if (parsed.success) return { kind: "ok", status: parsed.data };
  }
  if (response.status === 503) {
    const parsed = databaseUnavailableSchema.safeParse(response.body);
    if (parsed.success) return { kind: "database_unavailable", ...parsed.data };
  }
  return { kind: "unexpected_response", httpStatus: response.status };
}
