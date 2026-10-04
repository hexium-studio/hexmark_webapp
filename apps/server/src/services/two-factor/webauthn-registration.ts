import type { WebauthnCredentialSummary, WebauthnResponseJson } from "@hexmark/shared";
import {
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { WEBAUTHN_TIMEOUT_MS } from "../../config/two-factor";
import { users, webauthnCredentials, webauthnDeviceTypes } from "../../db/schema";
import { type Outcome, succeed } from "../../lib/outcome";
import type { ActorRef } from "./actor";
import { issueCeremony, takeCeremony } from "./challenges";
import { recoveryCodesForNewFactor, withFactorScope } from "./factor-transaction";
import { refuse } from "./refusals";
import type { FactorAdded } from "./totp-factor";
import { finishEnrolment } from "./totp-factor";
import {
  credentialSummary,
  enabledWebauthn,
  isWebauthnRefusal,
  knownTransports,
  signedChallenge,
  userKeys,
} from "./webauthn-common";

// Registering a security key or passkey as a second factor. Only as a second
// factor: no discoverable credential is requested (residentKey
// "discouraged"), user verification is welcome but not required, and no
// attestation is asked for, so any authenticator works and nothing about it
// is collected. Two steps: options (stores the ceremony's challenge), then
// verify (checks the browser's answer against it and stores the key).

export function registrationOptions(
  ref: ActorRef,
  now: Date,
): Promise<Outcome<PublicKeyCredentialCreationOptionsJSON>> {
  const config = enabledWebauthn();
  if (isWebauthnRefusal(config)) return Promise.resolve(config);
  // Not logged on success (no key yet); a refusal is, as a failed add.
  const options = { action: "two_factor.security_key_added" } as const;
  return withFactorScope(ref, now, options, async (scope) => {
    const userId = scope.actor.userId;
    const [user] = await scope.tx
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    const keys = await userKeys(scope.tx, userId);
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userName: user?.email ?? userId,
      userDisplayName: user?.displayName ?? "",
      // The account id as user handle: stable and without personal data.
      userID: Buffer.from(userId.replaceAll("-", ""), "hex"),
      timeout: WEBAUTHN_TIMEOUT_MS,
      attestationType: "none",
      excludeCredentials: keys.map((key) => ({
        id: key.credentialId,
        ...(key.transports ? { transports: key.transports } : {}),
      })),
      authenticatorSelection: {
        residentKey: "discouraged",
        requireResidentKey: false,
        userVerification: "preferred",
      },
    });
    await issueCeremony(scope.tx, {
      userId,
      purpose: "webauthn_registration",
      challenge: options.challenge,
      now,
    });
    return succeed(options);
  });
}

export interface KeyAdded extends FactorAdded {
  credential: WebauthnCredentialSummary;
}

export function verifyRegistration(
  ref: ActorRef,
  input: { name: string; response: WebauthnResponseJson },
  now: Date,
): Promise<Outcome<KeyAdded>> {
  const config = enabledWebauthn();
  if (isWebauthnRefusal(config)) return Promise.resolve(config);
  const options = { action: "two_factor.security_key_added" } as const;
  return withFactorScope(ref, now, options, async (scope) => {
    const userId = scope.actor.userId;
    const challenge = signedChallenge(input.response);
    const ceremony = challenge
      ? await takeCeremony(scope.tx, { userId, purpose: "webauthn_registration", challenge, now })
      : null;
    if (!ceremony?.webauthnChallenge) return refuse("webauthn_registration_failed");
    let info: Awaited<ReturnType<typeof verifyRegistrationResponse>>["registrationInfo"];
    try {
      const result = await verifyRegistrationResponse({
        response: input.response as unknown as RegistrationResponseJSON,
        expectedChallenge: ceremony.webauthnChallenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        requireUserVerification: false,
      });
      info = result.verified ? result.registrationInfo : undefined;
    } catch {
      info = undefined;
    }
    if (!info) return refuse("webauthn_registration_failed");
    const { credential } = info;
    const deviceType = webauthnDeviceTypes.includes(info.credentialDeviceType)
      ? info.credentialDeviceType
      : null;
    const [row] = await scope.tx
      .insert(webauthnCredentials)
      .values({
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: knownTransports(input.response.response.transports),
        name: input.name,
        aaguid: info.aaguid,
        deviceType,
        backedUp: info.credentialBackedUp,
        createdAt: now,
      })
      .onConflictDoNothing({ target: webauthnCredentials.credentialId })
      .returning();
    if (!row) return refuse("credential_exists");
    const recoveryCodes = await recoveryCodesForNewFactor(scope, now);
    await scope.record({
      target: { kind: "security_key", id: row.id, label: row.name },
      details: { deviceType, recoveryCodeCount: recoveryCodes?.length ?? 0 },
    });
    return succeed({
      userId,
      credential: credentialSummary(row),
      recoveryCodes,
      completesEnrolment: await finishEnrolment(scope, now),
      remember: scope.actor.remember,
    });
  });
}
