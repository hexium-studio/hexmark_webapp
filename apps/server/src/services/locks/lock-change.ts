import type { AuditAction, LockResult, LockState, LockTargetKind } from "@hexmark/shared";
import type { Transaction } from "../../db/client";
import { type Failure, fail, type Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import type { AccessView } from "../access/access-view";
import { authorize, type Grant } from "../access/authorize";
import { recordAccessEvent } from "../audit/access-events";
import { runAudited } from "../audit/audited";
import { hiddenRefusal } from "../hidden/hidden-state";
import type { FolderHidden, FolderLock } from "../notes/folder-index";
import { isFailure, refuse } from "../notes/refusals";
import { type ChainCheck, folderChainRefusal, isAgent } from "./lock-guard";

// Locking and unlocking, for notes and folders alike (lock-actions.ts finds
// the row): the permission lock on the item, then the change on its row,
// locked for update in this transaction. Agents may lock (with a reason) but
// not inside something locked, nor what is hidden (answered hidden, with
// the lock refusal it meets as well in `locked`); only people unlock.
// Locking what holds a lock of its own already, or unlocking what does not,
// writes nothing and answers changed: false with a message. An agent locking
// what a folder above has locked already is refused with locked and
// alreadyLocked: true - there is nothing left to do. Every attempt is
// logged, refused ones too.

export interface LockSubject {
  kind: LockTargetKind;
  id: string;
  path: string;
  // A note's title, for the hidden refusal.
  title?: string;
  // The folder the item is in (a note) or below (a folder); null: root level.
  parentId: string | null;
  own: FolderLock | null;
  // Its own hidden mark, from the row locked for update.
  hidden: FolderHidden | null;
  // Writes the lock columns (null: unlock).
  write(tx: Transaction, lock: FolderLock | null, grant: Grant): Promise<void>;
  // The permission lock decided again on the chain above the item, as the
  // agent's write locks it (lock-guard.ts).
  recheck: ChainCheck;
  // The state after the change, as reads show it.
  state(view: AccessView, own: FolderLock | null): LockState | null;
}

const ALREADY_LOCKED =
  "It holds a lock of its own already (see locked): nothing was written, that lock stays as it was.";
const NOT_LOCKED = "It holds no lock of its own: nothing was written.";

export interface LockRequest {
  ref: AccessRef;
  now: Date;
  action: AuditAction;
  lock: boolean;
  input: Record<string, unknown> & { reason?: string };
  find(tx: Transaction, grant: Grant): Promise<LockSubject | Failure>;
}

function lockEvent(request: LockRequest, subject: LockSubject, before: FolderLock | null) {
  return {
    action: request.action,
    target: { kind: subject.kind, id: subject.id, label: subject.path },
    reason: request.input.reason ?? null,
    details: {
      changed: request.lock ? before === null : before !== null,
      ...(before
        ? { lockedAt: before.at.toISOString(), lockedBy: before.byName, lockReason: before.reason }
        : {}),
    },
  };
}

export function changeLock(request: LockRequest): Promise<Outcome<LockResult>> {
  const { ref, now, action, input } = request;
  return runAudited({ ref, action, input }, async (tx) => {
    const grant = await authorize(tx, ref, now, "lock");
    if (isFailure(grant)) return grant;
    if (!request.lock && isAgent(grant)) {
      return refuse("forbidden", { reason: "session_required" });
    }
    if (request.lock && isAgent(grant) && !input.reason) {
      return fail(400, "validation", { fields: { reason: { code: "required" } } });
    }
    const subject = await request.find(tx, grant);
    if (isFailure(subject)) return subject;
    // An agent cannot lock inside a locked folder: that would change it;
    // nor lock a hidden item (it cannot change it at all).
    if (request.lock) {
      const inside =
        subject.own === null
          ? await folderChainRefusal(tx, grant, subject.parentId, grant.view, subject.recheck)
          : null;
      // A refusal of the recheck (gone, out of reach) wins; a lock does not.
      const lockOnly = inside === null || inside.error === "locked";
      if (subject.hidden && isAgent(grant) && lockOnly) {
        const { kind, id, path, title } = subject;
        return hiddenRefusal({ kind, id, path, title }, subject.hidden, inside);
      }
      if (inside?.error === "locked") {
        return { ...inside, details: { ...inside.details, alreadyLocked: true } };
      }
      if (inside) return inside;
    }
    const before = subject.own;
    const unchanged = request.lock ? before !== null : before === null;
    const after: FolderLock | null = unchanged
      ? before
      : request.lock
        ? { at: now, byName: grant.access.actor.name, reason: input.reason ?? null }
        : null;
    if (!unchanged) await subject.write(tx, after, grant);
    await recordAccessEvent(tx, grant.access, lockEvent(request, subject, before), now);
    return {
      kind: subject.kind,
      id: subject.id,
      path: subject.path,
      locked: subject.state(grant.view, after),
      changed: !unchanged,
      ...(unchanged ? { message: request.lock ? ALREADY_LOCKED : NOT_LOCKED } : {}),
    } satisfies LockResult;
  });
}
