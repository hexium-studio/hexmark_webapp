import { eq } from "drizzle-orm";
import { getDb } from "../../../db/client";
import { users } from "../../../db/schema";
import { fail, type Outcome, succeed } from "../../../lib/outcome";
import { personActor } from "../../../services/audit/actor";
import { recordFailure } from "../../../services/audit/record";
import { verifyPassword } from "../../../services/password";
import {
  markReauthenticated,
  reauthenticatedUntil,
} from "../../../services/sessions/reauthentication";
import { refuse } from "../../../services/two-factor/refusals";
import { reserveLoginAttempt } from "./login-attempts";

// Re-entering the password in a signed-in session, for sensitive actions
// (services/sessions/reauthentication.ts). A wrong password counts against the same limit as failed
// sign-ins: both are guesses at a password. Success is logged with the
// session's mark, a wrong password or the rate limit afterwards
// (auth.reauthenticated).
export async function reauthenticate(
  session: { sessionId: string; user: { id: string; username: string } },
  password: string,
  address: string,
  now: Date,
): Promise<Outcome<{ ok: true; reauthenticatedUntil: string }>> {
  const actor = personActor(session.user);
  const refused = async (code: "rate_limited" | "invalid_password") => {
    await recordFailure({
      actor,
      source: "web",
      action: "auth.reauthenticated",
      errorCode: code,
      target: { kind: "user", id: session.user.id, label: session.user.username },
    });
    return refuse(code);
  };
  const attempt = reserveLoginAttempt(address);
  if (!attempt) return refused("rate_limited");
  try {
    const [user] = await getDb()
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, session.user.id));
    if (!(await verifyPassword(user?.passwordHash ?? null, password))) {
      return refused("invalid_password");
    }
    attempt.release();
    if (!(await markReauthenticated(session.sessionId, now, actor))) {
      return refuse("unauthenticated");
    }
    const until = reauthenticatedUntil(now);
    return until
      ? succeed({ ok: true, reauthenticatedUntil: until.toISOString() })
      : fail(500, "internal");
  } catch (error) {
    attempt.release();
    throw error;
  }
}
