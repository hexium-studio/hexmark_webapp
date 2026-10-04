import type { AuditEventsPage, AuditEventsQuery, AuditEventView } from "@hexmark/shared";
import { type SQL, sql } from "drizzle-orm";
import type { Outcome } from "../../lib/outcome";
import { type AccessRef, lockAccess } from "../access/access";
import { fieldRefusal, isFailure, refuse } from "../notes/refusals";
import { runAudited } from "./audited";
import { decodeCursor, encodeCursor } from "./query-cursor";

// Reading the audit log (GET /api/audit/v1/events): newest first, filtered,
// one page at a time with a cursor on (occurred_at, id), so a time range is
// reached directly instead of by paging through everything after it.
//
// Who sees what is decided here, on the locked session: administrators see
// every event; other people only events they caused themselves or through
// one of their API tokens. Agents (API tokens) cannot read the log at all.
// Reads of the log are not logged (people's reads never are); a refused one
// is (audit.read).

interface EventRow extends Record<string, unknown> {
  id: string;
  occurred_at: Date | string;
  cursor_at: string;
  actor_kind: AuditEventView["actor"]["kind"];
  actor_user_id: string | null;
  actor_token_id: string | null;
  actor_name: string;
  source: AuditEventView["source"];
  action: string;
  outcome: AuditEventView["outcome"];
  error_code: string | null;
  target_kind: string | null;
  target_id: string | null;
  target_label: string | null;
  reason: string | null;
  details: Record<string, unknown>;
}

// LIKE patterns: % and _ in the value are meant literally.
function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function filters(query: AuditEventsQuery, cursor: { at: string; id: string } | null): SQL[] {
  const where: SQL[] = [];
  if (query.actor !== undefined) {
    where.push(
      query.actorMatch === "partial"
        ? sql`e.actor_name ilike ${`%${likeEscape(query.actor)}%`}`
        : sql`e.actor_name = ${query.actor}`,
    );
  }
  if (query.actorKind) where.push(sql`e.actor_kind = ${query.actorKind}`);
  if (query.action) {
    where.push(
      query.action.endsWith(".")
        ? sql`e.action like ${`${likeEscape(query.action)}%`}`
        : sql`e.action = ${query.action}`,
    );
  }
  if (query.outcome) where.push(sql`e.outcome = ${query.outcome}`);
  if (query.targetKind) where.push(sql`e.target_kind = ${query.targetKind}`);
  if (query.targetId) where.push(sql`e.target_id = ${query.targetId}::uuid`);
  if (query.from) where.push(sql`e.occurred_at >= ${query.from.toISOString()}::timestamptz`);
  if (query.to) where.push(sql`e.occurred_at < ${query.to.toISOString()}::timestamptz`);
  if (cursor) {
    where.push(sql`(e.occurred_at, e.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`);
  }
  return where;
}

function view(row: EventRow): AuditEventView {
  return {
    id: row.id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    actor: {
      kind: row.actor_kind,
      name: row.actor_name,
      userId: row.actor_user_id,
      tokenId: row.actor_token_id,
    },
    source: row.source,
    action: row.action,
    outcome: row.outcome,
    errorCode: row.error_code,
    target: row.target_kind
      ? { kind: row.target_kind, id: row.target_id, label: row.target_label }
      : null,
    reason: row.reason,
    details: row.details,
  };
}

export function queryAuditEvents(
  ref: AccessRef,
  now: Date,
  query: AuditEventsQuery,
): Promise<Outcome<AuditEventsPage>> {
  return runAudited({ ref, action: "audit.read", input: query }, async (tx) => {
    const access = await lockAccess(tx, ref, now);
    if (isFailure(access)) return access;
    if (access.ref.kind !== "session") return refuse("forbidden", { reason: "session_required" });
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !cursor) return fieldRefusal("cursor", "invalid");
    const where = filters(query, cursor);
    if (access.role !== "admin") {
      where.push(sql`(e.actor_user_id = ${access.userId}::uuid or e.actor_token_id in
        (select t.id from api_tokens t where t.user_id = ${access.userId}::uuid))`);
    }
    const rows = await tx.execute<EventRow>(sql`
      select e.*, to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        as cursor_at
      from audit_events e
      where ${where.length > 0 ? sql.join(where, sql` and `) : sql`true`}
      order by e.occurred_at desc, e.id desc
      limit ${query.limit + 1}
    `);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      events: page.map(view),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.cursor_at, last.id) : null,
    };
  });
}
