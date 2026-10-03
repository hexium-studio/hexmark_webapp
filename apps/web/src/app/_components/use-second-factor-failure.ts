"use client";

import { useFactorToast } from "@/components/two-factor/use-factor-toast";
import type { FactorMessageCode } from "@/lib/two-factor/factor-result";

export interface SignInFailure {
  error: FactorMessageCode;
  attemptsRemaining?: number;
}

// What a refused second step does at sign-in: a challenge that ran out
// leads back to the password with an info toast; the last wrong answer
// (the challenge is burnt) leads back with an error toast; everything else
// stays on the step with an error toast, which counts the attempts left.
export function useSecondFactorFailure(onRestart: (reason: "back" | "expired") => void) {
  const showError = useFactorToast();
  return (failure: SignInFailure) => {
    if (failure.error === "challenge_invalid") return onRestart("expired");
    if (failure.attemptsRemaining === 0) {
      showError("attempts_exhausted");
      return onRestart("back");
    }
    showError(failure.error, { attemptsRemaining: failure.attemptsRemaining });
  };
}
