import {
  totpCodeInputSchema,
  type WebauthnCredentialSummary,
  webauthnRegistrationInputSchema,
} from "@hexmark/shared";
import type { Context } from "hono";
import { failureResponse, sendOutcome } from "../../lib/outcome";
import { parseJsonBody } from "../../lib/validation";
import { completeSignIn } from "../sessions/complete-sign-in";
import type { ActorRef } from "./actor";
import { logFactorInput } from "./request-actor";
import { confirmTotp, type FactorAdded, startTotp } from "./totp-factor";
import { registrationOptions, verifyRegistration } from "./webauthn-registration";

// Request handlers for adding a factor, shared by the account page
// (session), forced enrolment at sign-in (enrolment challenge) and the setup
// wizard (setup ticket). Each module passes how its requests are authorised;
// the operation, its rules and its answers are the same everywhere.

export type ResolveActor = (
  c: Context,
  now: Date,
) => Promise<ActorRef | Response> | ActorRef | Response;

type AddedExtra = { credential?: WebauthnCredentialSummary };

// The answer once a factor was added: the recovery codes created with it (if
// it was the first one), and for forced enrolment the session that starts now.
async function factorAddedResponse(
  c: Context,
  added: FactorAdded & AddedExtra,
  now: Date,
): Promise<Response> {
  const body = {
    ok: true as const,
    recoveryCodes: added.recoveryCodes,
    ...(added.credential ? { credential: added.credential } : {}),
  };
  if (!added.completesEnrolment) return c.json(body, 200);
  const signedIn = await completeSignIn(
    { userId: added.userId, remember: added.remember, method: "enrolment" },
    c.req.header("user-agent") ?? null,
    now,
  );
  if (!signedIn.ok) return failureResponse(c, signedIn);
  return c.json({ ...signedIn.value, ...body }, 200);
}

export function totpStartHandler(resolve: ResolveActor) {
  return async (c: Context): Promise<Response> => {
    const now = new Date();
    const actor = await resolve(c, now);
    if (actor instanceof Response) return actor;
    return sendOutcome(c, await startTotp(actor, now), (value) => c.json(value, 200));
  };
}

export function totpConfirmHandler(resolve: ResolveActor) {
  return async (c: Context): Promise<Response> => {
    const now = new Date();
    const actor = await resolve(c, now);
    if (actor instanceof Response) return actor;
    const body = await parseJsonBody(c, totpCodeInputSchema);
    if (!body.ok) {
      await logFactorInput(c, actor, "two_factor.totp_added", body.response);
      return body.response;
    }
    const outcome = await confirmTotp(actor, body.data.code, now);
    if (!outcome.ok) return failureResponse(c, outcome);
    return factorAddedResponse(c, outcome.value, now);
  };
}

export function registrationOptionsHandler(resolve: ResolveActor) {
  return async (c: Context): Promise<Response> => {
    const now = new Date();
    const actor = await resolve(c, now);
    if (actor instanceof Response) return actor;
    return sendOutcome(c, await registrationOptions(actor, now), (options) =>
      c.json({ options }, 200),
    );
  };
}

export function registrationVerifyHandler(resolve: ResolveActor) {
  return async (c: Context): Promise<Response> => {
    const now = new Date();
    const actor = await resolve(c, now);
    if (actor instanceof Response) return actor;
    const body = await parseJsonBody(c, webauthnRegistrationInputSchema);
    if (!body.ok) {
      await logFactorInput(c, actor, "two_factor.security_key_added", body.response);
      return body.response;
    }
    const outcome = await verifyRegistration(actor, body.data, now);
    if (!outcome.ok) return failureResponse(c, outcome);
    return factorAddedResponse(c, outcome.value, now);
  };
}
