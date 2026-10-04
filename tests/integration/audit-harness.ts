import type { TestDatabase } from "../support/databases";
import { insertRow } from "./notes-harness";

// Helpers for the tests of the audit_events table (migration 0009).

// A successful action of the server itself, as the application writes it.
export function systemEvent(values: Record<string, unknown> = {}) {
  return {
    actor_kind: "system",
    actor_name: "System",
    source: "system",
    action: "trash.purged",
    outcome: "success",
    ...values,
  };
}

// An action of a human, through the browser UI.
export function humanEvent(userId: string, values: Record<string, unknown> = {}) {
  return {
    actor_kind: "human",
    actor_user_id: userId,
    actor_name: "owner",
    source: "web",
    action: "note.updated",
    outcome: "success",
    ...values,
  };
}

// An action of an agent, through the MCP server.
export function agentEvent(tokenId: string, values: Record<string, unknown> = {}) {
  return {
    actor_kind: "agent",
    actor_token_id: tokenId,
    actor_name: "agent",
    source: "mcp",
    action: "mcp.read_section",
    outcome: "success",
    ...values,
  };
}

export async function insertEvent(db: TestDatabase, row: Record<string, unknown>) {
  return insertRow(db, "audit_events", row);
}

// Runs `work` in a transaction that has set the purge setting, as the
// retention purge does.
export function asPurge<T>(db: TestDatabase, work: (tx: TestDatabase["sql"]) => Promise<T>) {
  return db.sql.begin(async (tx) => {
    await tx`set local hexmark.audit_purge = 'on'`;
    return work(tx as unknown as TestDatabase["sql"]);
  });
}

export const APPEND_ONLY = /audit_events is append-only/;
