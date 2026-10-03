"use client";

import { TOTP_DIGITS } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { CodeInput, type CodeInputHandle } from "@/components/code-input/CodeInput";
import { emptyCode, filledCount } from "@/components/code-input/code-model";
import type { FactorFailure } from "@/lib/two-factor/factor-result";
import { groupManualKey } from "@/lib/two-factor/manual-key";
import type { QrSvg } from "@/lib/two-factor/qr-code";
import { confirmTotp, startTotp } from "./actions";
import { CopyButton } from "./CopyButton";
import type { FactorContext } from "./factor-context";
import { QrCode } from "./QrCode";
import styles from "./TotpSetup.module.css";
import { useFactorToast } from "./use-factor-toast";

export const TOTP_CODE_RULES = { length: TOTP_DIGITS, allowed: /^[0-9]$/ } as const;

// Placeholder while the key loads: as long as a real one (20 bytes in
// base32), so the box keeps its size.
const KEY_PLACEHOLDER = "X".repeat(32);

export interface TotpSetupProps {
  context: FactorContext;
  // Prefix of element ids, unique on the page.
  id: string;
  // The app is a factor now; `recoveryCodes` when it was the first one.
  onAdded(recoveryCodes: string[] | null): void;
  onCancel(): void;
  // Refusals that end the whole flow (challenge or ticket gone, session
  // ended). Return true when handled; the rest becomes a toast here.
  onFailure?(failure: FactorFailure): boolean;
}

type Pairing = { state: "loading" } | { state: "ready"; secret: string; qr: QrSvg };

// Adding an authenticator app: the server creates a secret, the page shows
// it as a QR code and as a key to type in, and the app's current code
// confirms it. "Confirm" stays disabled until all digits are entered; a
// wrong code marks the cells red (the toast says why) until the next edit.
export function TotpSetup({ context, id, onAdded, onCancel, onFailure }: TotpSetupProps) {
  const t = useTranslations("twoFactor.totp");
  const showError = useFactorToast();
  const [pairing, setPairing] = useState<Pairing>({ state: "loading" });
  const [code, setCode] = useState(() => emptyCode(TOTP_DIGITS));
  const [rejected, setRejected] = useState(false);
  const [isPending, startTransition] = useTransition();
  const codeRef = useRef<CodeInputHandle>(null);
  const entered = filledCount(code);
  const complete = entered === TOTP_DIGITS;

  function fail(failure: FactorFailure) {
    if (onFailure?.(failure)) return;
    showError(failure.error);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: starts once per mount; a new start replaces the pending one on the server
  useEffect(() => {
    let current = true;
    startTotp(context).then((result) => {
      if (!current) return;
      if (result.ok) setPairing({ state: "ready", secret: result.secret, qr: result.qr });
      else fail(result);
    });
    return () => {
      current = false;
    };
  }, [context]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || !complete || pairing.state !== "ready") return;
    startTransition(async () => {
      const result = await confirmTotp(context, code.join(""));
      if (result.ok) return onAdded(result.recoveryCodes);
      if (result.error === "invalid_code") {
        setRejected(true);
        codeRef.current?.focus(0);
      }
      fail(result);
    });
  }

  const ready = pairing.state === "ready";
  const groups = groupManualKey(ready ? pairing.secret : KEY_PLACEHOLDER);
  return (
    <div className={styles.setup}>
      <div className={styles.pairing} aria-busy={!ready}>
        <QrCode qr={ready ? pairing.qr : undefined} label={t("qrLabel")} />
        <div className={styles.manual}>
          <p className={styles.text}>{ready ? t("scan") : t("loading")}</p>
          <p className={styles.text}>{t("manual")}</p>
          <p className={`${styles.key} ${ready ? "" : styles.concealed}`} id={`${id}-key`}>
            {groups.map((group, index) => (
              // The groups never change order; their position is their identity.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <span key={index}>{group}</span>
            ))}
          </p>
          <div className={ready ? undefined : styles.concealed}>
            <CopyButton
              text={ready ? pairing.secret : ""}
              label={t("copyKey")}
              copiedTitle={t("keyCopied")}
            />
          </div>
        </div>
      </div>
      <form className={styles.confirm} noValidate onSubmit={handleSubmit}>
        <CodeInput
          ref={codeRef}
          id={`${id}-code`}
          legend={t("codeLegend")}
          hint={t("codeHint", { length: TOTP_DIGITS })}
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
        <div className={styles.actions}>
          <Button
            type="submit"
            disabled={!complete || !ready}
            pending={isPending}
            aria-describedby={complete ? undefined : `${id}-progress`}
          >
            {isPending ? t("confirming") : t("confirm")}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            {t("cancel")}
          </Button>
          {complete ? null : (
            <span id={`${id}-progress`} className="visually-hidden">
              {t("progress", { length: TOTP_DIGITS, entered })}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
