import type { AuditAction } from "@hexmark/shared";
import type { Transaction } from "../../db/client";
import { describeError } from "../../lib/errors";
import type { Failure } from "../../lib/outcome";
import type { Access, AccessRef } from "../access/access";
import { type AuditActor, actorOfAccess, actorOfRef, sourceOf } from "./actor";
import { type AuditTarget, recordEvent, recordEvents, recordFailure } from "./record";
import { summarizeInput, summarizeRefusal } from "./sanitize";

// Audit events of requests that act through a session or an API token
// (services/access): the notes core, the trash and API tokens.

export interface AccessEvent {
  action: AuditAction;
  target?: AuditTarget | null;
  reason?: string | null;
  details?: Record<string, unknown>;
}

// A successful action, in its transaction, for the access it was decided on.
export function recordAccessEvent(
  tx: Transaction,
  access: Access,
  event: AccessEvent,
  now?: Date,
): Promise<void> {
  return recordEvent(
    tx,
    { ...event, actor: actorOfAccess(access), source: sourceOf(access.ref) },
    now,
  );
}

// Several events of one action (the items a folder took along), in its
// transaction.
export function recordAccessEvents(
  tx: Transaction,
  access: Access,
  events: readonly AccessEvent[],
  now?: Date,
): Promise<void> {
  const actor = actorOfAccess(access);
  const source = sourceOf(access.ref);
  return recordEvents(
    tx,
    events.map((event) => ({ ...event, actor, source })),
    now,
  );
}

// Reads are logged for agents only (an API token, over HTTP or MCP), never
// for people.
export async function recordAgentRead(
  tx: Transaction,
  access: Access,
  event: AccessEvent,
  now?: Date,
): Promise<void> {
  if (access.ref.kind === "token") await recordAccessEvent(tx, access, event, now);
}

// What a request tried, for its failure: the action, the input as sent
// (summarized, never stored whole) and, when known, the target.
export interface AttemptInfo {
  ref: AccessRef;
  action: AuditAction;
  input?: unknown;
  target?: AuditTarget | null;
}

// A refused or failed request, after its transaction ended. The input's
// reason (if any) goes into the reason column.
export async function recordAttemptFailure(attempt: AttemptInfo, failure: Failure): Promise<void> {
  const input = summarizeInput(attempt.input);
  const refusal = summarizeRefusal(failure.details);
  const reason = (attempt.input as { reason?: unknown } | undefined)?.reason;
  let actor: AuditActor;
  try {
    actor = await actorOfRef(attempt.ref);
  } catch (error) {
    console.error(`Audit event ${attempt.action} (failure) not written: ${describeError(error)}`);
    return;
  }
  await recordFailure({
    actor,
    source: sourceOf(attempt.ref),
    action: attempt.action,
    errorCode: failure.error,
    target: attempt.target ?? null,
    reason: typeof reason === "string" ? reason : null,
    details: {
      input,
      ...(Object.keys(refusal).length > 0 ? { refusal } : {}),
    },
  });
}
