import type { WebauthnResponseJson } from "@hexmark/shared";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  type PublicKeyCredentialRequestOptionsJSON,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import { WEBAUTHN_TIMEOUT_MS } from "../../../config/two-factor";
import { getDb, type Transaction } from "../../../db/client";
import { type AuthChallenge, webauthnCredentials } from "../../../db/schema";
import { type Outcome, succeed } from "../../../lib/outcome";
import {
  issueCeremony,
  lockChallenge,
  takeCeremony,
} from "../../../services/two-factor/challenges";
import { refuse } from "../../../services/two-factor/refusals";
import {
  type EnabledWebauthn,
  enabledWebauthn,
  isWebauthnRefusal,
  signedChallenge,
  userKeys,
} from "../../../services/two-factor/webauthn-common";
import type { Verdict } from "./second-factor";

// Signing in with a security key as the second factor: options for the
// browser (a ceremony stored under the sign-in challenge, never outliving
// it), then the check of the browser's answer inside proveSecondFactor.

export async function authenticationOptions(
  tokenHash: string,
  now: Date,
): Promise<Outcome<PublicKeyCredentialRequestOptionsJSON>> {
  const config = enabledWebauthn();
  if (isWebauthnRefusal(config)) return config;
  return getDb().transaction(async (tx) => {
    const challenge = await lockChallenge(tx, tokenHash, ["second_factor"], now);
    if (!challenge) return refuse("challenge_invalid");
    const keys = await userKeys(tx, challenge.userId);
    if (keys.length === 0) return refuse("method_unavailable");
    const options = await generateAuthenticationOptions({
      rpID: config.rpID,
      timeout: WEBAUTHN_TIMEOUT_MS,
      userVerification: "preferred",
      allowCredentials: keys.map((key) => ({
        id: key.credentialId,
        ...(key.transports ? { transports: key.transports } : {}),
      })),
    });
    await issueCeremony(tx, {
      userId: challenge.userId,
      purpose: "webauthn_authentication",
      challenge: options.challenge,
      now,
      notAfter: challenge.expiresAt,
    });
    return succeed(options);
  });
}

// Wrong: no open ceremony for the signed challenge, a key that is not one of
// the user's, or an answer that does not verify (signature, origin, RP ID,
// or a signature counter that went backwards).
async function verdict(
  tx: Transaction,
  challenge: AuthChallenge,
  config: EnabledWebauthn,
  response: WebauthnResponseJson,
  now: Date,
): Promise<Verdict> {
  const signed = signedChallenge(response);
  const ceremony = signed
    ? await takeCeremony(tx, {
        userId: challenge.userId,
        purpose: "webauthn_authentication",
        challenge: signed,
        now,
      })
    : null;
  if (!ceremony?.webauthnChallenge) return "wrong";
  const own = and(
    eq(webauthnCredentials.credentialId, response.id),
    eq(webauthnCredentials.userId, challenge.userId),
  );
  const [key] = await tx.select().from(webauthnCredentials).where(own).for("update");
  if (!key) return "wrong";
  try {
    const result = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge: ceremony.webauthnChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: false,
      credential: {
        id: key.credentialId,
        publicKey: new Uint8Array(key.publicKey),
        counter: key.counter,
        ...(key.transports ? { transports: key.transports } : {}),
      },
    });
    if (!result.verified) return "wrong";
    await tx
      .update(webauthnCredentials)
      .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: now })
      .where(eq(webauthnCredentials.id, key.id));
    return "right";
  } catch {
    return "wrong";
  }
}

// The check for proveSecondFactor; refuses up front when security keys are
// not offered.
export function checkWebauthn(response: WebauthnResponseJson, now: Date) {
  return async (tx: Transaction, challenge: AuthChallenge): Promise<Verdict> => {
    const config = enabledWebauthn();
    if (isWebauthnRefusal(config)) return config;
    return verdict(tx, challenge, config, response, now);
  };
}
