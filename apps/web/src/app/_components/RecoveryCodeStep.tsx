"use client";

import { RECOVERY_CODE_LENGTH } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { emptyCode, filledCount } from "@/components/code-input/code-model";
import fieldStyles from "@/components/field/Field.module.css";
import { cancelHeadingFocus, requestHeadingFocus } from "./heading-focus";
import { RecoveryCodeInput } from "./RecoveryCodeInput";
import styles from "./SecondFactor.module.css";
import { verifyRecoveryCode } from "./second-factor-actions";
import { useSecondFactorFailure } from "./use-second-factor-failure";

const FIELD_ID = "recovery-code";
const REASON_ID = "recovery-code-reason";

export interface RecoveryCodeStepProps {
  onBack(): void;
  onRestart(reason: "back" | "expired"): void;
}

// Signing in with one of the saved recovery codes instead of the second
// factor. Each code works once; the server counts it as used on success.
// "Verify" stays disabled until all 12 characters are in.
export function RecoveryCodeStep({ onBack, onRestart }: RecoveryCodeStepProps) {
  const t = useTranslations("secondFactor.recovery");
  const [code, setCode] = useState(() => emptyCode(RECOVERY_CODE_LENGTH));
  const [rejected, setRejected] = useState(false);
  const [isPending, startTransition] = useTransition();
  const firstRef = useRef<HTMLInputElement>(null);
  const handleFailure = useSecondFactorFailure(onRestart);
  const complete = filledCount(code) === RECOVERY_CODE_LENGTH;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || !complete) return;
    requestHeadingFocus();
    startTransition(async () => {
      const result = await verifyRecoveryCode(code.join(""));
      if (result.ok) return;
      cancelHeadingFocus();
      if (result.error === "invalid_code") {
        setRejected(true);
        firstRef.current?.focus();
      }
      handleFailure(result);
    });
  }

  return (
    <form className={styles.form} noValidate onSubmit={handleSubmit}>
      <fieldset className={styles.fieldset}>
        <legend className={fieldStyles.label}>{t("legend")}</legend>
        <p id={`${FIELD_ID}-hint`} className={`${fieldStyles.hint} ${styles.hint}`}>
          {t("hint", { length: RECOVERY_CODE_LENGTH })}
        </p>
        <RecoveryCodeInput
          id={FIELD_ID}
          value={code}
          invalid={rejected}
          firstRef={firstRef}
          onValueChange={(next) => {
            setCode(next);
            setRejected(false);
          }}
        />
      </fieldset>
      <Button
        type="submit"
        className={styles.wide}
        disabled={!complete}
        pending={isPending}
        aria-describedby={complete ? undefined : REASON_ID}
      >
        {isPending ? t("verifying") : t("verify")}
      </Button>
      {complete ? null : (
        <span id={REASON_ID} className="visually-hidden">
          {t("incomplete", { length: RECOVERY_CODE_LENGTH })}
        </span>
      )}
      <div className={styles.links}>
        <button type="button" className={styles.link} onClick={onBack}>
          {t("back")}
        </button>
      </div>
    </form>
  );
}
