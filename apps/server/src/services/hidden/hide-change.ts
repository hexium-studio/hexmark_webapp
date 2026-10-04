import type { AuditAction, HiddenState, HideResult, LockTargetKind } from "@hexmark/shared";
import type { Transaction } from "../../db/client";
import { type Failure, fail, type Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import type { AccessView } from "../access/access-view";
import { authorize, type Grant } from "../access/authorize";
import { recordAccessEvent } from "../audit/access-events";
import { runAudited } from "../audit/audited";
import { isAgent } from "../locks/lock-guard";
import type { FolderHidden } from "../notes/folder-index";
import { isFailure, refuse } from "../notes/refusals";
import { reauthenticationRefusal } from "../sessions/reauthentication";

// Hiding and unhiding, for notes and folders alike (hide-actions.ts finds
// the row and locks it for update, with share locks on the folders above
// it). Agents with the hide permission may hide, with a reason; only people
// unhide, with their password re-entered in the last 10 minutes: unhiding
// lets every agent read again what was hidden, so it is a sensitive action
// like creating an API token. Hiding is allowed on locked items (it only
// takes more away from agents); unhiding never touches a lock. Hiding what
// is hidden already, or unhiding what is not, writes nothing and answers
// changed: false with a message, like every write that changes nothing.
// Every attempt is logged, refused ones too.

export interface HideSubject {
  kind: LockTargetKind;
  id: string;
  path: string;
  own: FolderHidden | null;
  // Writes the hidden columns (null: unhide).
  write(tx: Transaction, mark: FolderHidden | null, grant: Grant): Promise<void>;
  // The state after the change, as reads show it.
  state(view: AccessView, own: FolderHidden | null): HiddenState | null;
}

const ALREADY_HIDDEN =
  "It is hidden itself already (see hidden): nothing was written, that mark stays as it was.";
const NOT_HIDDEN = "It is not hidden itself: nothing was written.";

export interface HideRequest {
  ref: AccessRef;
  now: Date;
  action: AuditAction;
  hide: boolean;
  input: Record<string, unknown> & { reason?: string };
  find(tx: Transaction, grant: Grant): Promise<HideSubject | Failure>;
}

function hideEvent(request: HideRequest, subject: HideSubject, before: FolderHidden | null) {
  return {
    action: request.action,
    target: { kind: subject.kind, id: subject.id, label: subject.path },
    reason: request.input.reason ?? null,
    details: {
      changed: request.hide ? before === null : before !== null,
      ...(before
        ? { hiddenAt: before.at.toISOString(), hiddenBy: before.byName, hideReason: before.reason }
        : {}),
    },
  };
}

// Who may: anyone holding hide may hide (an agent with a reason); only a
// person unhides, recently re-authenticated.
function callerRefusal(request: HideRequest, grant: Grant): Failure | null {
  if (request.hide) {
    return isAgent(grant) && !request.input.reason
      ? fail(400, "validation", { fields: { reason: { code: "required" } } })
      : null;
  }
  if (isAgent(grant)) return refuse("forbidden", { reason: "session_required" });
  return reauthenticationRefusal(grant.access.reauthenticatedAt, request.now);
}

export function changeHidden(request: HideRequest): Promise<Outcome<HideResult>> {
  const { ref, now, action, input } = request;
  return runAudited({ ref, action, input }, async (tx) => {
    const grant = await authorize(tx, ref, now, "hide");
    if (isFailure(grant)) return grant;
    const refused = callerRefusal(request, grant);
    if (refused) return refused;
    const subject = await request.find(tx, grant);
    if (isFailure(subject)) return subject;
    const before = subject.own;
    const unchanged = request.hide ? before !== null : before === null;
    const after: FolderHidden | null = unchanged
      ? before
      : request.hide
        ? { at: now, byName: grant.access.actor.name, reason: input.reason ?? null }
        : null;
    if (!unchanged) await subject.write(tx, after, grant);
    await recordAccessEvent(tx, grant.access, hideEvent(request, subject, before), now);
    return {
      kind: subject.kind,
      id: subject.id,
      path: subject.path,
      hidden: subject.state(grant.view, after),
      changed: !unchanged,
      ...(unchanged ? { message: request.hide ? ALREADY_HIDDEN : NOT_HIDDEN } : {}),
    } satisfies HideResult;
  });
}
