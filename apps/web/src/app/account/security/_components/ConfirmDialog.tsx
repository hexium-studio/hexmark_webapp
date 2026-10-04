"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { Dialog } from "@/components/dialog/Dialog";
import { PasswordField } from "@/components/field/PasswordField";
import { reauthenticate } from "@/components/reauthentication/actions";
import { isRecentlyConfirmed } from "@/components/reauthentication/recent";
import { useFactorToast } from "@/components/two-factor/use-factor-toast";
import styles from "./Security.module.css";
import { performSensitive, type SensitiveRequest, type SensitiveResult } from "./sensitive";

const TITLE_ID = "confirm-dialog-title";
const PASSWORD_ID = "confirm-password";

export interface ConfirmDialogProps {
  request: SensitiveRequest | null;
  reauthenticatedUntil: string | null;
  onReauthenticated(until: string): void;
  onClose(): void;
  // The action went through; `result` may carry new recovery codes.
  onDone(request: SensitiveRequest, result: Extract<SensitiveResult, { ok: true }>): void;
  // The action was refused for a reason the page must reflect (it reloads).
  onRefused(): void;
}

// Confirms a sensitive change in a modal dialog: what will happen, the key
// it concerns spelled out in full (wrapped, never cut off, so two similar
// names stay distinguishable), and – when the last confirmation is older
// than 10 minutes – the password. A wrong password is an error at the
// field; other refusals close the dialog and become a toast.
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { request, onClose } = props;
  return (
    <Dialog open={request !== null} labelledBy={TITLE_ID} onClose={onClose}>
      {request ? <DialogBody {...props} request={request} /> : null}
    </Dialog>
  );
}

function DialogBody(props: ConfirmDialogProps & { request: SensitiveRequest }) {
  const { request, onClose } = props;
  const t = useTranslations("accountSecurity.confirm");
  const showError = useFactorToast();
  const [needPassword, setNeedPassword] = useState(
    () => !isRecentlyConfirmed(props.reauthenticatedUntil),
  );
  const [passwordError, setPasswordError] = useState<string>();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // First stop: the password when it is asked for, else the safe "Cancel".
  useEffect(() => {
    const target = needPassword ? `#${PASSWORD_ID}` : "button[data-cancel]";
    formRef.current?.querySelector<HTMLElement>(target)?.focus();
  }, [needPassword]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    if (needPassword && password === "") return setPasswordError(t("passwordMissing"));
    startTransition(async () => {
      if (needPassword) {
        const confirmed = await reauthenticate(password);
        if (!confirmed.ok) {
          if (confirmed.error === "invalid_password") {
            setPasswordError(t("passwordWrong"));
            return formRef.current?.querySelector<HTMLInputElement>(`#${PASSWORD_ID}`)?.focus();
          }
          onClose();
          return showError(confirmed.error);
        }
        props.onReauthenticated(confirmed.until);
      }
      const result = await performSensitive(request);
      if (result.ok) return props.onDone(request, result);
      if (result.error === "reauthentication_required") return setNeedPassword(true);
      onClose();
      showError(result.error);
      props.onRefused();
    });
  }

  const subject = request.kind === "removeKey" ? request.name : undefined;
  const removesLast = request.kind !== "regenerate" && request.removesLast;
  return (
    <form ref={formRef} className={styles.dialogForm} noValidate onSubmit={handleSubmit}>
      <h2 id={TITLE_ID} className={styles.dialogTitle}>
        {t(`${request.kind}.title`)}
      </h2>
      {subject ? <p className={styles.subject}>{subject}</p> : null}
      <p className={styles.muted}>{t(`${request.kind}.detail`)}</p>
      {removesLast ? <p className={styles.muted}>{t("lastFactorNote")}</p> : null}
      {needPassword ? (
        <PasswordField
          id={PASSWORD_ID}
          name="password"
          label={t("passwordLabel")}
          hint={t("passwordHint")}
          error={passwordError}
          reserve={[t("passwordWrong"), t("passwordMissing")]}
          autoComplete="current-password"
          toggleSubject={t("passwordToggle")}
          onChange={() => setPasswordError(undefined)}
        />
      ) : null}
      <div className={styles.dialogActions}>
        <Button type="submit" pending={isPending}>
          {isPending ? t("working") : t(`${request.kind}.action`)}
        </Button>
        <Button variant="secondary" data-cancel onClick={onClose}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
