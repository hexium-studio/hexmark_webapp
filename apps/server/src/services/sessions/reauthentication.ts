import { and, eq, gt, isNull } from "drizzle-orm";
import { REAUTHENTICATION_WINDOW_MS } from "../../config/two-factor";
import { getDb } from "../../db/client";
import { sessions } from "../../db/schema";
import type { Failure } from "../../lib/outcome";
import type { AuditActor } from "../audit/actor";
import { recordEvent } from "../audit/record";
import { refuse } from "../two-factor/refusals";

// "Recent authentication": sensitive actions (removing a factor, new
// recovery codes, creating an API token, deleting from the trash for good)
// require the password to have been entered again in this session within
// REAUTHENTICATION_WINDOW_MS.

export function isRecentlyReauthenticated(reauthenticatedAt: Date | null, now: Date): boolean {
  if (reauthenticatedAt === null) return false;
  const age = now.getTime() - reauthenticatedAt.getTime();
  return age >= 0 && age < REAUTHENTICATION_WINDOW_MS;
}

// The one refusal for every sensitive action. Callers pass reauthenticatedAt
// as read from the session row they hold locked in their transaction, so
// the decision rests on the row the write depends on.
export function reauthenticationRefusal(reauthenticatedAt: Date | null, now: Date): Failure | null {
  return isRecentlyReauthenticated(reauthenticatedAt, now)
    ? null
    : refuse("reauthentication_required");
}

export function reauthenticatedUntil(reauthenticatedAt: Date | null): Date | null {
  return reauthenticatedAt && new Date(reauthenticatedAt.getTime() + REAUTHENTICATION_WINDOW_MS);
}

// Records the re-entered password on the session, and in the audit log in
// the same transaction. The conditions are part of the update, so a session
// revoked or expired in the meantime is not marked. False when nothing was
// marked.
export async function markReauthenticated(
  sessionId: string,
  now: Date,
  actor: AuditActor,
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .update(sessions)
      .set({ reauthenticatedAt: now })
      .where(
        and(eq(sessions.id, sessionId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)),
      )
      .returning({ id: sessions.id });
    if (rows.length === 0) return false;
    const target = { kind: "user" as const, id: actor.userId, label: actor.name };
    const event = { action: "auth.reauthenticated" as const, target, details: { sessionId } };
    await recordEvent(tx, { actor, source: "web", ...event }, now);
    return true;
  });
}
