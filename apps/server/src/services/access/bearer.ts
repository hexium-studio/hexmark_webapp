import { and, eq, isNull, lt, or } from "drizzle-orm";
import { TOKEN_REJECTION_LOG } from "../../config/audit";
import { TOKEN_LAST_USED_INTERVAL_MS } from "../../config/notes";
import { getDb } from "../../db/client";
import { apiTokens } from "../../db/schema";
import { LogThrottle } from "../../lib/log-throttle";
import type { Failure } from "../../lib/outcome";
import { hashApiToken } from "../api-tokens/token-format";
import { INVALID_TOKEN, tokenActor } from "../audit/actor";
import { recordFailure } from "../audit/record";
import { isFailure, refuse } from "../notes/refusals";
import { type AccessRef, lockAccess } from "./access";

// Rejected tokens logged so far, by digest (this process only).
const rejections = new LogThrottle(TOKEN_REJECTION_LOG);

// Authenticates an agent's API token: finds it by its digest, checks it with
// the same rules every operation applies again (access.ts) and records the
// use. last_used_at is written at most once per interval, to limit writes.
// A token that is unknown, revoked or expired is logged as
// auth.token_rejected: a known one with its name, an unknown one as
// "invalid token" (nothing of what was sent is kept) - at most once per
// presented value (its digest) in a window, so a client that keeps sending
// a bad token does not flood the log; the next event says how many were
// left out (details.suppressed; config/audit.ts).
export async function authenticateBearer(
  token: string,
  now: Date,
  via: "http" | "mcp",
): Promise<AccessRef | Failure> {
  const hash = hashApiToken(token);
  let known: { id: string; name: string } | undefined;
  const outcome = await getDb().transaction(async (tx) => {
    [known] = await tx
      .select({ id: apiTokens.id, name: apiTokens.name })
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, hash));
    if (!known) return refuse("unauthenticated");
    const ref: AccessRef = { kind: "token", tokenId: known.id, via };
    const access = await lockAccess(tx, ref, now);
    if (isFailure(access)) return access;
    const stale = new Date(now.getTime() - TOKEN_LAST_USED_INTERVAL_MS);
    await tx
      .update(apiTokens)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiTokens.id, known.id),
          or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, stale)),
        ),
      );
    return ref;
  });
  // Refusals of the instance as a whole (setup token still set, keys
  // missing) are not about the token.
  const decision =
    isFailure(outcome) && outcome.status === 401 ? rejections.admit(hash, now.getTime()) : null;
  if (isFailure(outcome) && decision?.log) {
    await recordFailure({
      actor: known ? tokenActor(known) : INVALID_TOKEN,
      source: via,
      action: "auth.token_rejected",
      errorCode: outcome.error,
      target: known ? { kind: "token", id: known.id, label: known.name } : null,
      details: decision.suppressed > 0 ? { suppressed: decision.suppressed } : {},
    });
  }
  return outcome;
}
