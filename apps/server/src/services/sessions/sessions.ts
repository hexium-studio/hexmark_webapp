import type { AuthUser } from "@hexmark/shared";
import { eq, or } from "drizzle-orm";
import {
  SESSION_ROTATION_GRACE_MS,
  type SessionDurations,
  sessionDurations,
} from "../../config/session";
import { getDb, type Transaction } from "../../db/client";
import { SESSION_USER_AGENT_MAX_LENGTH, sessions, users } from "../../db/schema";
import { personActor } from "../audit/actor";
import { recordEvent } from "../audit/record";
import { countFactors, lockFactorOwner, signInRequirement } from "../two-factor/factor-state";
import { evaluateSessionUse, type TokenMatch } from "./session-rules";
import { hashSessionToken, newSessionToken } from "./session-token";
import { type SignInRefusal, signInRefusal } from "./sign-in-policy";

// Creating, using and revoking sessions. Every decision about an existing
// session is made on its row while that row is locked (select ... for update)
// and written in the same transaction, so a logout, a rotation or a second
// request with the same token cannot slip in between check and write.
// `now` is passed in by the caller (the request time; a fixed time in tests).

export const authUserColumns = {
  id: users.id,
  displayName: users.displayName,
  username: users.username,
  role: users.role,
  locale: users.locale,
};

export type CreateSessionResult =
  | { status: "created"; token: string; expiresAt: Date }
  | { status: "refused"; reason: SignInRefusal }
  // The password alone is not enough for this account (factor-state.ts).
  | { status: "second_factor_required" }
  | { status: "enrolment_required" };

// How the person proved who they are, for the audit log.
export type SignInMethod = "password" | "totp" | "webauthn" | "recovery_code" | "enrolment";

export interface NewSessionInput {
  userId: string;
  remember: boolean;
  userAgent: string | null;
  // The caller verified a second factor (or recovery code) of this user,
  // or the user just added their first one.
  secondFactorVerified: boolean;
  method: SignInMethod;
}

// The one place sessions are created. Whether the password alone suffices
// is decided here, under the locks of factor-state.ts and in the transaction
// that inserts the session, so no way of signing in can skip the second
// factor and a factor added meanwhile is seen. The sign-in is logged in the
// same transaction (auth.sign_in).
export async function createSession(
  input: NewSessionInput,
  now: Date,
  durations: SessionDurations = sessionDurations,
): Promise<CreateSessionResult> {
  const refusal = signInRefusal();
  if (refusal) return { status: "refused", reason: refusal };
  return getDb().transaction(async (tx) => {
    const owner = await lockFactorOwner(tx, input.userId, { settings: "share", user: "share" });
    if (!owner) throw new Error("cannot create a session for a missing user");
    if (!input.secondFactorVerified) {
      const requirement = signInRequirement(
        owner.requireTwoFactor,
        await countFactors(tx, input.userId),
      );
      if (requirement === "second_factor") return { status: "second_factor_required" } as const;
      if (requirement === "enrolment") return { status: "enrolment_required" } as const;
    }
    const { token, hash } = newSessionToken();
    const expiresAt = new Date(now.getTime() + durations.maxAgeMs);
    const [session] = await tx
      .insert(sessions)
      .values({
        userId: input.userId,
        tokenHash: hash,
        remember: input.remember,
        createdAt: now,
        lastSeenAt: now,
        rotatedAt: now,
        expiresAt,
        userAgent: input.userAgent?.slice(0, SESSION_USER_AGENT_MAX_LENGTH) ?? null,
      })
      .returning({ id: sessions.id });
    const actor = personActor({ id: input.userId, username: owner.username });
    await recordEvent(
      tx,
      {
        actor,
        source: "web",
        action: "auth.sign_in",
        target: { kind: "user", id: input.userId, label: owner.username },
        details: { method: input.method, remember: input.remember, sessionId: session?.id },
      },
      now,
    );
    return { status: "created", token, expiresAt } as const;
  });
}

// The session a token belongs to, with its user, locked until the
// transaction ends. A token matches either the current token or the one
// replaced at the last rotation.
async function lockSession(tx: Transaction, hash: string) {
  const [row] = await tx
    .select({ session: sessions, user: authUserColumns })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(or(eq(sessions.tokenHash, hash), eq(sessions.previousTokenHash, hash)))
    .limit(1)
    .for("update", { of: sessions });
  if (!row) return null;
  const match: TokenMatch = row.session.tokenHash === hash ? "current" : "previous";
  return { ...row, match };
}

export interface SessionInfo {
  sessionId: string;
  user: AuthUser;
  session: { rotatedToken?: string; expiresAt: Date; remember: boolean };
}

// Validates a token and records the use: last_seen_at (at most once per
// interval) and, when due, a new token. Null when there is no live session
// for the token. `rotate: false` never replaces the token: for endpoints
// whose answers do not pass a new token on (GET /api/auth/v1/me does).
export async function useSession(
  token: string,
  now: Date,
  durations: SessionDurations = sessionDurations,
  options: { rotate?: boolean } = {},
): Promise<SessionInfo | null> {
  const hash = hashSessionToken(token);
  return getDb().transaction(async (tx) => {
    const locked = await lockSession(tx, hash);
    if (!locked) return null;
    const use = evaluateSessionUse(locked.session, locked.match, now, durations);
    if (!use.valid) return null;
    const { id, expiresAt, remember } = locked.session;
    let rotatedToken: string | undefined;
    if (use.rotate && options.rotate !== false) {
      const next = newSessionToken();
      await tx
        .update(sessions)
        .set({
          tokenHash: next.hash,
          previousTokenHash: hash,
          previousValidUntil: new Date(now.getTime() + SESSION_ROTATION_GRACE_MS),
          rotatedAt: now,
          lastSeenAt: now,
        })
        .where(eq(sessions.id, id));
      rotatedToken = next.token;
    } else if (use.touch || use.rotate) {
      await tx.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
    }
    const session = rotatedToken ? { rotatedToken, expiresAt, remember } : { expiresAt, remember };
    return { sessionId: id, user: locked.user, session };
  });
}

// Ends the session the token belongs to (sign-out). False when there is no
// live session for the token: the same rule as useSession decides.
export async function revokeSession(
  token: string,
  now: Date,
  durations: SessionDurations = sessionDurations,
): Promise<boolean> {
  const hash = hashSessionToken(token);
  return getDb().transaction(async (tx) => {
    const locked = await lockSession(tx, hash);
    if (!locked) return false;
    if (!evaluateSessionUse(locked.session, locked.match, now, durations).valid) return false;
    await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, locked.session.id));
    const { user } = locked;
    await recordEvent(
      tx,
      {
        actor: personActor(user),
        source: "web",
        action: "auth.sign_out",
        target: { kind: "user", id: user.id, label: user.username },
        details: { sessionId: locked.session.id },
      },
      now,
    );
    return true;
  });
}
