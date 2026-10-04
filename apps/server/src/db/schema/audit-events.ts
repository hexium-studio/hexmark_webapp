import {
  AUDIT_ACTOR_KINDS,
  AUDIT_OUTCOMES,
  AUDIT_SOURCES,
  REVISION_REASON_MAX_LENGTH,
} from "@hexmark/shared";
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { actorChecks, actorColumns } from "./actor-columns";
import { idColumn } from "./id-column";

// Who acted (human, agent, system), where the action came in (web, http,
// mcp, system) and how it ended: shared with the query API
// (@hexmark/shared). Changing a list needs a migration of the matching check
// below.
export {
  AUDIT_ACTOR_KINDS,
  AUDIT_OUTCOMES,
  AUDIT_SOURCES,
  type AuditActorKind,
  type AuditOutcome,
  type AuditSource,
} from "@hexmark/shared";

// Actor name written for actions of the server itself.
export const AUDIT_SYSTEM_ACTOR_NAME = "System";
export const AUDIT_ACTION_MAX_LENGTH = 64;
export const AUDIT_ERROR_CODE_MAX_LENGTH = 64;
export const AUDIT_TARGET_KIND_MAX_LENGTH = 32;
export const AUDIT_TARGET_LABEL_MAX_LENGTH = 1000;
export const AUDIT_REASON_MAX_LENGTH = REVISION_REASON_MAX_LENGTH;
// Upper bound for `details` as stored (pg_column_size, after compression).
export const AUDIT_DETAILS_MAX_BYTES = 16384;

// Session setting that allows deleting rows, see below.
export const AUDIT_PURGE_SETTING = "hexmark.audit_purge";

const actor = actorColumns("actor");
const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));
const max = (value: number) => sql.raw(String(value));

// The audit log: one row per action of a human, an agent or the server,
// written in the same transaction as the action (a failed action is written
// afterwards in a transaction of its own). No IP addresses are stored.
//
// Append-only, enforced by triggers created in migration 0009 (Drizzle does
// not describe triggers, so they exist only in the SQL):
// - UPDATE is refused. The one exception is the foreign key action that sets
//   actor_user_id or actor_token_id to null when that user or token is
//   deleted; nothing else in the row may change, and actor_name keeps the
//   name.
// - DELETE and TRUNCATE are refused unless the transaction has set
//   `set local hexmark.audit_purge = 'on'` first. Only the retention purge
//   (AUDIT_RETENTION_DAYS) does that.
// The triggers guard against mistakes in the application; they are not a
// boundary against the database owner, who can disable them.
export const auditEvents = pgTable(
  "audit_events",
  {
    id: idColumn(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorKind: text("actor_kind", { enum: AUDIT_ACTOR_KINDS }).notNull(),
    // Set on insert for a human (user id) or an agent (token id); null for
    // the system, and again null once that user or token is deleted.
    actorUserId: actor.userId,
    actorTokenId: actor.tokenId,
    // Username, token name or "System", as it was at the time.
    actorName: actor.name.notNull(),
    source: text("source", { enum: AUDIT_SOURCES }).notNull(),
    // Dotted code from the catalogue (AUDIT_ACTIONS in @hexmark/shared), such
    // as note.updated, auth.sign_in_failed, read.section.
    action: text("action").notNull(),
    outcome: text("outcome", { enum: AUDIT_OUTCOMES }).notNull(),
    // Set exactly when the outcome is failure.
    errorCode: text("error_code"),
    // What the action was about (note, folder, user, token, session,
    // settings, trash_batch, ...), its id and its path or name at the time.
    targetKind: text("target_kind"),
    targetId: uuid("target_id"),
    targetLabel: text("target_label"),
    reason: text("reason"),
    // Further facts, never secrets, passwords, tokens or full note bodies.
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    // Filters of the log: time range, actor, action, failures, target.
    index("audit_events_occurred_at_idx").on(table.occurredAt.desc().nullsFirst()),
    index("audit_events_actor_name_idx").on(table.actorName, table.occurredAt.desc().nullsFirst()),
    index("audit_events_actor_user_id_idx").on(
      table.actorUserId,
      table.occurredAt.desc().nullsFirst(),
    ),
    index("audit_events_actor_token_id_idx").on(
      table.actorTokenId,
      table.occurredAt.desc().nullsFirst(),
    ),
    index("audit_events_action_idx").on(table.action, table.occurredAt.desc().nullsFirst()),
    index("audit_events_failure_idx")
      .on(table.outcome, table.occurredAt.desc().nullsFirst())
      .where(sql`${table.outcome} = 'failure'`),
    index("audit_events_target_idx").on(table.targetKind, table.targetId),
    ...actorChecks("audit_events", "actor", {
      userId: table.actorUserId,
      tokenId: table.actorTokenId,
      name: table.actorName,
    }),
    check("audit_events_actor_kind_check", sql`${table.actorKind} in (${list(AUDIT_ACTOR_KINDS)})`),
    // A human never has a token id, an agent never a user id, the system
    // neither and always the name "System".
    check(
      "audit_events_actor_kind_ids_check",
      sql`(${table.actorKind} = 'human' and ${table.actorTokenId} is null) or (${table.actorKind} = 'agent' and ${table.actorUserId} is null) or (${table.actorKind} = 'system' and ${table.actorUserId} is null and ${table.actorTokenId} is null and ${table.actorName} = ${sql.raw(`'${AUDIT_SYSTEM_ACTOR_NAME}'`)})`,
    ),
    check("audit_events_source_check", sql`${table.source} in (${list(AUDIT_SOURCES)})`),
    check(
      "audit_events_action_format_check",
      sql`char_length(${table.action}) <= ${max(AUDIT_ACTION_MAX_LENGTH)} and ${table.action} ~ '^[a-z_]+(\\.[a-z_]+)+$'`,
    ),
    check("audit_events_outcome_check", sql`${table.outcome} in (${list(AUDIT_OUTCOMES)})`),
    check(
      "audit_events_error_code_check",
      sql`(${table.outcome} = 'success' and ${table.errorCode} is null) or (${table.outcome} = 'failure' and ${table.errorCode} is not null and char_length(${table.errorCode}) <= ${max(AUDIT_ERROR_CODE_MAX_LENGTH)} and ${table.errorCode} ~ '^[a-z][a-z0-9_]*$')`,
    ),
    check(
      "audit_events_target_kind_format_check",
      sql`char_length(${table.targetKind}) <= ${max(AUDIT_TARGET_KIND_MAX_LENGTH)} and ${table.targetKind} ~ '^[a-z][a-z_]*$'`,
    ),
    // An id or a label only together with the kind of target.
    check(
      "audit_events_target_pairing_check",
      sql`${table.targetKind} is not null or (${table.targetId} is null and ${table.targetLabel} is null)`,
    ),
    check(
      "audit_events_target_label_length_check",
      sql`char_length(${table.targetLabel}) between 1 and ${max(AUDIT_TARGET_LABEL_MAX_LENGTH)}`,
    ),
    check(
      "audit_events_reason_length_check",
      sql`char_length(${table.reason}) <= ${max(AUDIT_REASON_MAX_LENGTH)}`,
    ),
    check("audit_events_details_object_check", sql`jsonb_typeof(${table.details}) = 'object'`),
    check(
      "audit_events_details_size_check",
      sql`pg_column_size(${table.details}) <= ${max(AUDIT_DETAILS_MAX_BYTES)}`,
    ),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
