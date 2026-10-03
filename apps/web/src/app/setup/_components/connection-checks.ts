import { SETUP_TOKEN_LENGTH } from "@hexmark/shared";
import type { CheckState } from "@/components/check-status/CheckStatus";
import type { Messages } from "@/lib/locales/registry";
import type { SetupStatusResult } from "@/lib/setup-status";

// Turns the status loaded by page.tsx into the four checks of the
// connection step. Texts are message keys under "setup.connection"; the
// step translates them.

export type CheckDetailKey = keyof Messages["setup"]["connection"]["detail"];

export interface ConnectionCheck {
  id: keyof Messages["setup"]["connection"]["labels"];
  state: CheckState;
  detail: CheckDetailKey;
  values?: Record<string, string | number>;
}

function serverCheck(status: SetupStatusResult): ConnectionCheck {
  if (status.kind === "server_unreachable") {
    return { id: "server", state: "fail", detail: "serverUnreachable" };
  }
  if (status.kind === "unexpected_response") {
    return {
      id: "server",
      state: "fail",
      detail: "serverUnexpected",
      // A string, so it is not formatted as a number ("1,000").
      values: { status: String(status.httpStatus) },
    };
  }
  return { id: "server", state: "pass", detail: "serverPass" };
}

function databaseCheck(status: SetupStatusResult): ConnectionCheck {
  if (status.kind === "server_unreachable" || status.kind === "unexpected_response") {
    return { id: "database", state: "unknown", detail: "notChecked" };
  }
  const database = status.kind === "ok" ? status.status.database : status.database;
  if (!database.reachable) return { id: "database", state: "fail", detail: "databaseUnreachable" };
  if (!database.migrated) return { id: "database", state: "fail", detail: "databaseNotMigrated" };
  return { id: "database", state: "pass", detail: "databasePass" };
}

function tokenCheck(status: SetupStatusResult): ConnectionCheck {
  if (status.kind === "server_unreachable" || status.kind === "unexpected_response") {
    return { id: "token", state: "unknown", detail: "notChecked" };
  }
  const configured =
    status.kind === "ok" ? status.status.setupTokenConfigured : status.setupTokenConfigured;
  if (configured) return { id: "token", state: "pass", detail: "tokenPass" };
  // Only a 200 status says whether the token is missing or malformed.
  const present = status.kind === "ok" ? status.status.setupTokenPresent : undefined;
  const detail: CheckDetailKey =
    present === true ? "tokenInvalid" : present === false ? "tokenMissing" : "tokenUnknown";
  return { id: "token", state: "fail", detail, values: { length: SETUP_TOKEN_LENGTH } };
}

// INTERNAL_API_KEY and ENCRYPTION_KEY in the server's .env.
function configCheck(status: SetupStatusResult): ConnectionCheck {
  if (status.kind === "server_unreachable" || status.kind === "unexpected_response") {
    return { id: "config", state: "unknown", detail: "notChecked" };
  }
  const configured =
    status.kind === "ok" ? status.status.secretsConfigured : status.secretsConfigured;
  return configured
    ? { id: "config", state: "pass", detail: "configPass" }
    : { id: "config", state: "fail", detail: "configMissing" };
}

export function connectionChecks(status: SetupStatusResult): ConnectionCheck[] {
  return [serverCheck(status), databaseCheck(status), configCheck(status), tokenCheck(status)];
}
