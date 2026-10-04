import type { AuditAction, AuditSource, AuditTargetKind } from "@hexmark/shared";
import { getDb, type Transaction } from "../../db/client";
import {
  AUDIT_REASON_MAX_LENGTH,
  AUDIT_TARGET_LABEL_MAX_LENGTH,
  auditEvents,
  type NewAuditEvent,
} from "../../db/schema";
import { describeError } from "../../lib/errors";
import { isUuid } from "../notes/addressing";
import type { AuditActor } from "./actor";
import { clip, sanitizeDetails } from "./sanitize";

// Writing audit events. Two ways, and only these two:
// - recordEvent: a successful action, inside the transaction that performs
//   it, so the event exists exactly when the action does.
// - recordFailure: an action that was refused or failed, in a transaction of
//   its own after the action's transaction ended (rolled back), so the
//   failure is kept although nothing of the action is.
// Details always pass sanitize.ts; nothing secret is written.

export interface AuditTarget {
  kind: AuditTargetKind;
  id?: string | null;
  // The path or name at the time.
  label?: string | null;
}

export interface AuditEventInput {
  actor: AuditActor;
  source: AuditSource;
  action: AuditAction;
  target?: AuditTarget | null;
  reason?: string | null;
  details?: Record<string, unknown>;
}

export interface AuditFailureInput extends AuditEventInput {
  // The code the client got (e.g. version_conflict, invalid_credentials).
  errorCode: string;
}

const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;

function eventRow(event: AuditEventInput, now: Date, errorCode: string | null): NewAuditEvent {
  const { actor, target } = event;
  const label = target?.label ? clip(target.label, AUDIT_TARGET_LABEL_MAX_LENGTH) : null;
  const reason = event.reason ? clip(event.reason, AUDIT_REASON_MAX_LENGTH) : null;
  return {
    occurredAt: now,
    actorKind: actor.kind,
    actorUserId: actor.userId,
    actorTokenId: actor.tokenId,
    actorName: actor.name,
    source: event.source,
    action: event.action,
    outcome: errorCode === null ? "success" : "failure",
    errorCode,
    targetKind: target?.kind ?? null,
    targetId: target?.id && isUuid(target.id) ? target.id.toLowerCase() : null,
    targetLabel: label,
    reason,
    details: sanitizeDetails(event.details),
  };
}

// Inside the action's transaction: fails (and rolls the action back) when
// the event cannot be written.
export async function recordEvent(
  tx: Transaction,
  event: AuditEventInput,
  now = new Date(),
): Promise<void> {
  await tx.insert(auditEvents).values(eventRow(event, now, null));
}

// Rows per statement when one action writes many events (a purge).
const BATCH = 500;

export async function recordEvents(
  tx: Transaction,
  events: readonly AuditEventInput[],
  now = new Date(),
): Promise<void> {
  for (let start = 0; start < events.length; start += BATCH) {
    const rows = events.slice(start, start + BATCH).map((event) => eventRow(event, now, null));
    await tx.insert(auditEvents).values(rows);
  }
}

// After the action ended without effect. A failure to write is logged and
// swallowed: the client still gets the answer to its request.
export async function recordFailure(event: AuditFailureInput, now = new Date()): Promise<void> {
  const errorCode = ERROR_CODE.test(event.errorCode) ? event.errorCode : "internal";
  try {
    await getDb()
      .insert(auditEvents)
      .values(eventRow(event, now, errorCode));
  } catch (error) {
    console.error(`Audit event ${event.action} (failure) not written: ${describeError(error)}`);
  }
}
