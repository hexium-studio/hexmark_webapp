import { and, eq, gt, isNull } from "drizzle-orm";
import { REAUTHENTICATION_WINDOW_MS } from "../../config/two-factor";
import { getDb } from "../../db/client";
import { sessions } from "../../db/schema";

// "Recent authentication": sensitive account actions (removing a factor,
// new recovery codes) require the password to have been entered again in
// this session within REAUTHENTICATION_WINDOW_MS.

export function isRecentlyReauthenticated(reauthenticatedAt: Date | null, now: Date): boolean {
  if (reauthenticatedAt === null) return false;
  const age = now.getTime() - reauthenticatedAt.getTime();
  return age >= 0 && age < REAUTHENTICATION_WINDOW_MS;
}

export function reauthenticatedUntil(reauthenticatedAt: Date | null): Date | null {
  return reauthenticatedAt && new Date(reauthenticatedAt.getTime() + REAUTHENTICATION_WINDOW_MS);
}

// Records the re-entered password on the session. The conditions are part
// of the update, so a session revoked or expired in the meantime is not
// marked. False when nothing was marked.
export async function markReauthenticated(sessionId: string, now: Date): Promise<boolean> {
  const rows = await getDb()
    .update(sessions)
    .set({ reauthenticatedAt: now })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .returning({ id: sessions.id });
  return rows.length > 0;
}
