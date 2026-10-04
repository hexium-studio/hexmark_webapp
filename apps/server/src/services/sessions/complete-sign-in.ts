import type { SignedInResponse } from "@hexmark/shared";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { users } from "../../db/schema";
import { fail, type Outcome, succeed } from "../../lib/outcome";
import { authUserColumns, createSession, type SignInMethod } from "./sessions";
import { signInRefusalFailure } from "./sign-in-policy";

// The last step of a sign-in that needed a second factor (or a first one,
// forced): the factor is proven, now the session starts. createSession still
// decides whether it may (e.g. not while SETUP_TOKEN is set).
export async function completeSignIn(
  proven: { userId: string; remember: boolean; method: SignInMethod },
  userAgent: string | null,
  now: Date,
): Promise<Outcome<SignedInResponse>> {
  const created = await createSession(
    {
      userId: proven.userId,
      remember: proven.remember,
      userAgent,
      secondFactorVerified: true,
      method: proven.method,
    },
    now,
  );
  if (created.status === "refused") return signInRefusalFailure(created.reason);
  if (created.status !== "created") return fail(500, "internal");
  const [user] = await getDb()
    .select(authUserColumns)
    .from(users)
    .where(eq(users.id, proven.userId));
  if (!user) return fail(500, "internal");
  return succeed({
    ok: true,
    status: "signed_in",
    user,
    session: {
      token: created.token,
      expiresAt: created.expiresAt.toISOString(),
      remember: proven.remember,
    },
  });
}
