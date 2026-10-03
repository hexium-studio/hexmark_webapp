import { eq } from "drizzle-orm";
import { getDb } from "../../../db/client";
import { users } from "../../../db/schema";
import { fail, type Outcome, succeed } from "../../../lib/outcome";
import { verifyPassword } from "../../../services/password";
import {
  markReauthenticated,
  reauthenticatedUntil,
} from "../../../services/sessions/reauthentication";
import { refuse } from "../../../services/two-factor/refusals";
import { reserveLoginAttempt } from "./login-attempts";

// Re-entering the password in a signed-in session, for sensitive account
// actions. A wrong password counts against the same limit as failed
// sign-ins: both are guesses at a password.
export async function reauthenticate(
  session: { sessionId: string; userId: string },
  password: string,
  address: string,
  now: Date,
): Promise<Outcome<{ ok: true; reauthenticatedUntil: string }>> {
  const attempt = reserveLoginAttempt(address);
  if (!attempt) return refuse("rate_limited");
  try {
    const [user] = await getDb()
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, session.userId));
    if (!(await verifyPassword(user?.passwordHash ?? null, password))) {
      return refuse("invalid_password");
    }
    attempt.release();
    if (!(await markReauthenticated(session.sessionId, now))) return refuse("unauthenticated");
    const until = reauthenticatedUntil(now);
    return until
      ? succeed({ ok: true, reauthenticatedUntil: until.toISOString() })
      : fail(500, "internal");
  } catch (error) {
    attempt.release();
    throw error;
  }
}
