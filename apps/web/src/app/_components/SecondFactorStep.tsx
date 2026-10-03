"use client";

import { type SecondFactorMethod, TOTP_DIGITS } from "@hexmark/shared";
import { startAuthentication } from "@simplewebauthn/browser";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { CodeInput, type CodeInputHandle } from "@/components/code-input/CodeInput";
import { emptyCode, filledCount } from "@/components/code-input/code-model";
import { TOTP_CODE_RULES } from "@/components/two-factor/TotpSetup";
import { browserWebauthnError } from "@/lib/two-factor/webauthn-errors";
import { useWebauthnSupport } from "@/lib/two-factor/webauthn-support";
import { cancelHeadingFocus, requestHeadingFocus } from "./heading-focus";
import { NoMethodAlert } from "./NoMethodAlert";
import styles from "./SecondFactor.module.css";
import {
  type SecondFactorResult,
  securityKeySignInOptions,
  verifySecurityKey,
  verifyTotpCode,
} from "./second-factor-actions";
import { useSecondFactorFailure } from "./use-second-factor-failure";

const CODE_ID = "second-factor-code";
const REASON_ID = "second-factor-code-reason";

export interface SecondFactorStepProps {
  methods: readonly SecondFactorMethod[];
  onRecovery(): void;
  onRestart(reason: "back" | "expired"): void;
}

// The second factor at sign-in, with what the account has: the security key
// (first, as the quickest), the authenticator app's code, and the way to a
// recovery code. Without any usable method, a note says whom to ask.
export function SecondFactorStep({ methods, onRecovery, onRestart }: SecondFactorStepProps) {
  const t = useTranslations("secondFactor");
  const support = useWebauthnSupport(methods.includes("webauthn"));
  const keyUsable = support === "usable";
  const totp = methods.includes("totp");
  const recovery = methods.includes("recovery");
  const [code, setCode] = useState(() => emptyCode(TOTP_DIGITS));
  const [rejected, setRejected] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [pendingKey, startKey] = useTransition();
  const codeRef = useRef<CodeInputHandle>(null);
  const handleFailure = useSecondFactorFailure(onRestart);
  const complete = filledCount(code) === TOTP_DIGITS;

  function settle(result: SecondFactorResult, wrongAnswer: () => void) {
    if (result.ok) return;
    cancelHeadingFocus();
    if (result.error === "invalid_code" || result.error === "webauthn_failed") wrongAnswer();
    handleFailure(result);
  }

  function handleCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || !complete) return;
    requestHeadingFocus();
    startTransition(async () => {
      settle(await verifyTotpCode(code.join("")), () => {
        setRejected(true);
        codeRef.current?.focus(0);
      });
    });
  }

  function signInWithKey() {
    if (pendingKey) return;
    startKey(async () => {
      const options = await securityKeySignInOptions();
      if (!options.ok) return handleFailure(options);
      let response: unknown;
      try {
        response = await startAuthentication({ optionsJSON: options.options });
      } catch (error) {
        return handleFailure({ error: browserWebauthnError(error) });
      }
      requestHeadingFocus();
      settle(await verifySecurityKey(response), () => {});
    });
  }

  if (!keyUsable && !totp && !recovery) {
    return <NoMethodAlert keyOnly={support === "browser"} onBack={() => onRestart("back")} />;
  }

  return (
    <div className={styles.step}>
      {keyUsable ? (
        <Button className={styles.wide} pending={pendingKey} onClick={signInWithKey}>
          {pendingKey ? t("key.waiting") : t("key.use")}
        </Button>
      ) : null}
      {keyUsable && totp ? (
        <p className={styles.divider}>
          <span>{t("or")}</span>
        </p>
      ) : null}
      {totp ? (
        <form className={styles.form} noValidate onSubmit={handleCode}>
          <CodeInput
            ref={codeRef}
            id={CODE_ID}
            legend={t("code.legend")}
            hint={t("code.hint", { length: TOTP_DIGITS })}
            invalid={rejected}
            value={code}
            onValueChange={(next) => {
              setCode(next);
              setRejected(false);
            }}
            {...TOTP_CODE_RULES}
            inputMode="numeric"
            autoComplete="one-time-code"
          />
          <Button
            type="submit"
            variant={keyUsable ? "secondary" : "primary"}
            className={styles.wide}
            disabled={!complete}
            pending={isPending}
            aria-describedby={complete ? undefined : REASON_ID}
          >
            {isPending ? t("code.verifying") : t("code.verify")}
          </Button>
          {complete ? null : (
            <span id={REASON_ID} className="visually-hidden">
              {t("code.incomplete", { length: TOTP_DIGITS })}
            </span>
          )}
        </form>
      ) : null}
      {support === "browser" ? <p className={styles.note}>{t("key.unusable")}</p> : null}
      <div className={styles.links}>
        {recovery ? (
          <button type="button" className={styles.link} onClick={onRecovery}>
            {t("useRecovery")}
          </button>
        ) : null}
        <button type="button" className={styles.link} onClick={() => onRestart("back")}>
          {t("back")}
        </button>
      </div>
    </div>
  );
}
