import type { Context } from "hono";
import { failureResponse, type Outcome } from "../../../lib/outcome";
import { clientAddress } from "../../../services/client-address";
import { challengeTokenHash, readChallengeToken } from "../../../services/two-factor/challenges";
import { refuse } from "../../../services/two-factor/refusals";
import { unavailable } from "../../../services/two-factor/request-actor";
import type { SignInContext } from "./second-factor";

// What a second-factor request at sign-in brings: the challenge token from
// `Authorization: Challenge <token>`, the client address (rate limit) and
// the user agent (stored with the session). A missing token is refused here;
// whether the challenge is usable is decided under its lock.
export function signInContext(c: Context, now: Date): SignInContext | Response {
  const blocked = unavailable(c);
  if (blocked) return blocked;
  const token = readChallengeToken(c.req.header("authorization"));
  if (!token) return failureResponse(c, refuse("challenge_invalid"));
  return {
    tokenHash: challengeTokenHash(token),
    address: clientAddress(c),
    userAgent: c.req.header("user-agent") ?? null,
    now,
  };
}

export function sendSignIn<T>(c: Context, outcome: Outcome<T>): Response {
  return outcome.ok ? c.json(outcome.value as object, 200) : failureResponse(c, outcome);
}
