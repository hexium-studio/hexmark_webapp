import type {
  EnrolmentRequiredResponse,
  SecondFactorMethod,
  SecondFactorRequiredResponse,
} from "@hexmark/shared";
import { webauthnConfig } from "../../../config/webauthn";
import { getDb } from "../../../db/client";
import { issueChallenge } from "../../../services/two-factor/challenges";
import { countFactors, countUnusedRecoveryCodes } from "../../../services/two-factor/factor-state";

// The challenge a correct password gets when it is not enough on its own
// (createSession said so). "Remember me" is stored on the challenge and
// carried to the session that the next step creates.

interface ChallengeInput {
  userId: string;
  remember: boolean;
  now: Date;
}

// What the account can prove itself with: its authenticator app, its
// security keys (only while the instance offers them) and recovery codes
// while it has unused ones.
export async function secondFactorChallenge(
  input: ChallengeInput,
): Promise<SecondFactorRequiredResponse> {
  return getDb().transaction(async (tx) => {
    const counts = await countFactors(tx, input.userId);
    const codes = await countUnusedRecoveryCodes(tx, input.userId);
    const methods: SecondFactorMethod[] = [];
    if (counts.totp) methods.push("totp");
    if (counts.webauthn > 0 && webauthnConfig().enabled) methods.push("webauthn");
    if (codes > 0) methods.push("recovery");
    const issued = await issueChallenge(tx, { ...input, purpose: "second_factor" });
    return {
      ok: false,
      status: "second_factor_required",
      challenge: { token: issued.token, expiresAt: issued.expiresAt.toISOString() },
      methods,
    };
  });
}

// Forced enrolment: the instance requires a second factor and the account
// has none. `methods`: what can be added on this instance.
export async function enrolmentChallenge(
  input: ChallengeInput,
): Promise<EnrolmentRequiredResponse> {
  const issued = await getDb().transaction((tx) =>
    issueChallenge(tx, { ...input, purpose: "enrolment" }),
  );
  return {
    ok: false,
    status: "enrolment_required",
    challenge: { token: issued.token, expiresAt: issued.expiresAt.toISOString() },
    methods: webauthnConfig().enabled ? ["totp", "webauthn"] : ["totp"],
  };
}
