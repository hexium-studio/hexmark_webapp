"use server";

import { redirect } from "next/navigation";
import { queueFlashToast } from "@/components/toast/flash-server";
import { challengeAuthorization, clearChallenge } from "@/lib/challenge/challenge-store";
import { callServer } from "@/lib/server-api";
import {
  type FactorFailure,
  factorFailure,
  readFactorFailure,
} from "@/lib/two-factor/factor-result";

// Step 6: saves the instance's default time zone and whether every account
// needs a second factor, with the setup ticket. Success uses the ticket up;
// its cookie goes, and the admin continues on the completion page.
export async function saveSystemSettings(input: {
  timezone: string;
  requireTwoFactor: boolean;
}): Promise<FactorFailure> {
  const authorization = await challengeAuthorization();
  if (!authorization) return factorFailure("challenge_invalid");
  const response = await callServer("/api/setup/v1/system-settings", {
    method: "PUT",
    headers: { authorization },
    body: {
      timezone: typeof input?.timezone === "string" ? input.timezone : "",
      requireTwoFactor: input?.requireTwoFactor === true,
    },
  });
  if (!response.reachable || response.status !== 200) {
    const failure = readFactorFailure(response);
    if (failure.error === "challenge_invalid") await clearChallenge();
    return failure;
  }
  await clearChallenge();
  await queueFlashToast("setupSaved");
  // redirect() throws; it must stay outside any try/catch.
  redirect("/setup/complete");
}
