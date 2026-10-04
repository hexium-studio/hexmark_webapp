import { Hono } from "hono";
import { getActions } from "./actions";
import { getEvents } from "./events";

// The audit log, version 1. Mounted at /api/audit/v1 (src/api/index.ts).
// Query and answer types: packages/shared/src/audit-api.ts; what is logged:
// docs/audit.md.
//
// Signed-in people only: header `Authorization: Session <token>` (the web
// app). An API token gets 403 forbidden { reason: "session_required" }:
// agents cannot read the log. Administrators see every event; everyone else
// sees the events they caused themselves or through one of their API
// tokens. Reading the log is not logged; a refused read is (audit.read).
//
// GET /events?actor&actorMatch&actorKind&action&outcome&targetKind&targetId
//            &from&to&cursor&limit
//   actor        actor name (username, token name, "System"); actorMatch
//                exact (default) or partial (contains, case ignored)
//   actorKind    human | agent | system
//   action       a code ("note.updated") or a prefix ending in "." ("note.")
//   outcome      success | failure
//   targetKind   note | folder | trash | user | token | security_key |
//                settings | audit; targetId: a UUID
//   from, to     ISO 8601 with a time zone; from inclusive, to exclusive
//   cursor       nextCursor of the previous page
//   limit        1-200 (default 50)
//   200 { events: [{ id, occurredAt, actor: { kind, name, userId, tokenId },
//         source, action, outcome, errorCode, target: { kind, id, label } |
//         null, reason, details }], nextCursor }  newest first (occurredAt,
//         then id); nextCursor null on the last page. Jumping to a date: pass
//         to (and from) instead of paging there.
//   400 validation { fields } (also cursor: invalid)
// GET /actions
//   200 { actions: [{ code, description, target, outcomes }] }  the catalogue
//       (AUDIT_ACTIONS in @hexmark/shared), for filters
//
// All endpoints: 401 unauthenticated, 403 forbidden | setup_token_present,
// 503 database_unavailable | server_not_configured. Cache-Control: no-store.

export const auditV1 = new Hono();

auditV1.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

auditV1.get("/events", getEvents);
auditV1.get("/actions", getActions);
