"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { RecoveryCodes } from "@/components/two-factor/RecoveryCodes";
import { SecurityKeySetup } from "@/components/two-factor/SecurityKeySetup";
import { TotpSetup } from "@/components/two-factor/TotpSetup";
import type { FactorFailure } from "@/lib/two-factor/factor-result";
import { useWebauthnSupport } from "@/lib/two-factor/webauthn-support";
import { requestHeadingFocus, SIGN_IN_TITLE_ID } from "./heading-focus";
import { NoMethodAlert } from "./NoMethodAlert";
import styles from "./SecondFactor.module.css";
import { finishEnrolment } from "./second-factor-actions";
import type { EnrolmentMethod } from "./sign-in-result";

const CODES_HEADING_ID = "enrolment-codes-heading";

type View = "choose" | "totp" | "key" | { codes: string[] };

export interface EnrolmentStepProps {
  methods: readonly EnrolmentMethod[];
  onRestart(reason: "back" | "expired"): void;
}

// Forced enrolment: the instance requires a second factor and the account
// has none. The user sets one up with the same parts as on the account page
// and in setup step 5 (components/two-factor/), saves the recovery codes,
// and only then is signed in (the session waits in its own cookie, see
// lib/session/session-store.ts).
export function EnrolmentStep({ methods, onRestart }: EnrolmentStepProps) {
  const t = useTranslations("secondFactor.enrolment");
  const support = useWebauthnSupport(methods.includes("webauthn"));
  const totp = methods.includes("totp");
  const key = support === "usable";
  const [view, setView] = useState<View>(() =>
    totp && !key ? "totp" : key && !totp ? "key" : "choose",
  );
  const [isFinishing, startFinishing] = useTransition();
  const codesHeading = useRef<HTMLHeadingElement>(null);
  const viewShown = useRef(false);

  // The control that was pressed is gone with the view it belonged to:
  // focus goes to the codes' heading, or back to the card's heading.
  useEffect(() => {
    if (!viewShown.current) {
      viewShown.current = true;
      return;
    }
    const target =
      typeof view === "object" ? codesHeading.current : document.getElementById(SIGN_IN_TITLE_ID);
    target?.focus();
  }, [view]);

  // A challenge that ran out ends the enrolment; everything else is a toast.
  function onFailure(failure: FactorFailure): boolean {
    if (failure.error !== "challenge_invalid") return false;
    onRestart("expired");
    return true;
  }

  function onAdded(codes: string[] | null) {
    if (codes) return setView({ codes });
    finish();
  }

  function finish() {
    requestHeadingFocus();
    startFinishing(async () => {
      const { ok } = await finishEnrolment();
      if (!ok) onRestart("expired");
    });
  }

  // Back to the choice, or out of the sign-in when there is none.
  const cancel = () => (totp && key ? setView("choose") : onRestart("back"));

  if (!totp && !key) {
    return (
      <NoMethodAlert
        keyOnly={support === "browser"}
        kind="enrolment"
        onBack={() => onRestart("back")}
      />
    );
  }
  if (typeof view === "object") {
    return (
      <div className={styles.step}>
        <h2 id={CODES_HEADING_ID} ref={codesHeading} tabIndex={-1} className={styles.subheading}>
          {t("codesHeading")}
        </h2>
        <RecoveryCodes
          codes={view.codes}
          labelledBy={CODES_HEADING_ID}
          doneLabel={isFinishing ? t("finishing") : t("finish")}
          onDone={finish}
        />
      </div>
    );
  }
  if (view === "totp") {
    return (
      <TotpSetup
        context="enrolment"
        id="enrol-totp"
        onAdded={onAdded}
        onCancel={cancel}
        onFailure={onFailure}
      />
    );
  }
  if (view === "key") {
    return (
      <SecurityKeySetup
        context="enrolment"
        id="enrol-key"
        onAdded={onAdded}
        onFailure={onFailure}
        secondaryAction={
          <Button variant="secondary" onClick={cancel}>
            {t("cancel")}
          </Button>
        }
      />
    );
  }
  return (
    <div className={styles.step}>
      <p className={styles.note}>{t("choose")}</p>
      <div className={styles.choices}>
        <Button className={styles.wide} onClick={() => setView("key")}>
          {t("useKey")}
        </Button>
        <Button variant="secondary" className={styles.wide} onClick={() => setView("totp")}>
          {t("useApp")}
        </Button>
      </div>
      <div className={styles.links}>
        <button type="button" className={styles.link} onClick={() => onRestart("back")}>
          {t("back")}
        </button>
      </div>
    </div>
  );
}
