"use client";

import type { SecondFactorMethod } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { CardShell } from "@/components/card-shell/CardShell";
import { FormAlert } from "@/components/form-alert/FormAlert";
import { toast } from "@/components/toast/toast-store";
import { EnrolmentStep } from "./EnrolmentStep";
import { ClaimHeadingFocus, SIGN_IN_TITLE_ID } from "./heading-focus";
import { RecoveryCodeStep } from "./RecoveryCodeStep";
import { SecondFactorStep } from "./SecondFactorStep";
import { SignInForm } from "./SignInForm";
import { abandonSignIn } from "./second-factor-actions";
import type { EnrolmentMethod, SignInResult } from "./sign-in-result";

// Where the sign-in stands. The challenge token itself stays in its httpOnly
// cookie; this is only what the page shows. A reload starts over at the
// password (the cookie is replaced by the next attempt).
export type SignInStep =
  | { view: "password" }
  | { view: "second-factor"; methods: SecondFactorMethod[] }
  | { view: "recovery"; methods: SecondFactorMethod[] }
  | { view: "enrolment"; methods: EnrolmentMethod[] };

export interface SignInFlowProps {
  // The API server gave no usable answer while loading the page.
  serverDown: boolean;
}

// The sign-in card and its steps: password, then the second factor (or a
// recovery code), or the forced set-up of one. Every step is a view of the
// same card; its heading takes focus when the step changes. Success stores
// the session cookie, and the page re-renders as home.
export function SignInFlow({ serverDown }: SignInFlowProps) {
  const t = useTranslations("auth");
  const tSecond = useTranslations("secondFactor");
  const [step, setStep] = useState<SignInStep>({ view: "password" });
  const moved = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on purpose whenever the step changes
  useEffect(() => {
    if (moved.current) document.getElementById(SIGN_IN_TITLE_ID)?.focus();
  }, [step.view]);

  function goTo(next: SignInStep) {
    moved.current = true;
    setStep(next);
  }

  function continueWith(result: Extract<SignInResult, { ok: true }>) {
    if (result.next === "second_factor") goTo({ view: "second-factor", methods: result.methods });
    if (result.next === "enrolment") goTo({ view: "enrolment", methods: result.methods });
  }

  // Back to the password; `expired`: the challenge ran out or was used up.
  function restart(reason: "back" | "expired") {
    void abandonSignIn();
    goTo({ view: "password" });
    if (reason === "expired") {
      toast.info({ title: tSecond("expired.title"), message: tSecond("expired.detail") });
    }
  }

  const title =
    step.view === "password"
      ? t("title")
      : tSecond(step.view === "second-factor" ? "title" : `${step.view}.title`);
  const lead = step.view === "password" ? undefined : tSecond(leadKey(step.view));

  return (
    <CardShell title={title} titleId={SIGN_IN_TITLE_ID} lead={lead}>
      <ClaimHeadingFocus targetId={SIGN_IN_TITLE_ID} />
      {step.view === "password" ? (
        <>
          {serverDown ? (
            <FormAlert tone="info" title={t("serverDown.title")}>
              <p>{t("serverDown.detail")}</p>
            </FormAlert>
          ) : null}
          <SignInForm onContinue={continueWith} />
        </>
      ) : null}
      {step.view === "second-factor" ? (
        <SecondFactorStep
          methods={step.methods}
          onRecovery={() => goTo({ view: "recovery", methods: step.methods })}
          onRestart={restart}
        />
      ) : null}
      {step.view === "recovery" ? (
        <RecoveryCodeStep
          onBack={() => goTo({ view: "second-factor", methods: step.methods })}
          onRestart={restart}
        />
      ) : null}
      {step.view === "enrolment" ? (
        <EnrolmentStep methods={step.methods} onRestart={restart} />
      ) : null}
    </CardShell>
  );
}

function leadKey(view: Exclude<SignInStep["view"], "password">) {
  if (view === "second-factor") return "lead" as const;
  return `${view}.lead` as const;
}
