"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { Dialog } from "@/components/dialog/Dialog";
import { PasswordField } from "@/components/field/PasswordField";
import { reauthenticate } from "@/components/reauthentication/actions";
import styles from "./Tokens.module.css";
import { useTokenToast } from "./use-token-toast";

const TITLE_ID = "reauth-dialog-title";
const PASSWORD_ID = "reauth-password";

export interface ReauthDialogProps {
  open: boolean;
  onClose(): void;
  // The password was confirmed until `until`; the caller creates the token.
  onConfirmed(until: string): void;
}

// Asks for the password before a token is created, with the same
// confirmation the account security page uses (valid for 10 minutes). A
// wrong password is an error at the field; other refusals close the dialog
// and become a toast.
export function ReauthDialog(props: ReauthDialogProps) {
  return (
    <Dialog open={props.open} labelledBy={TITLE_ID} onClose={props.onClose}>
      {props.open ? <DialogBody {...props} /> : null}
    </Dialog>
  );
}

function DialogBody({ onClose, onConfirmed }: ReauthDialogProps) {
  const t = useTranslations("tokens.confirm");
  const showError = useTokenToast();
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const focusPassword = () =>
    formRef.current?.querySelector<HTMLInputElement>(`#${PASSWORD_ID}`)?.focus();

  useEffect(focusPassword, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    if (password === "") return setError(t("passwordMissing"));
    startTransition(async () => {
      const result = await reauthenticate(password);
      if (result.ok) return onConfirmed(result.until);
      if (result.error === "invalid_password") {
        setError(t("passwordWrong"));
        return focusPassword();
      }
      onClose();
      showError(result.error);
    });
  }

  return (
    <form ref={formRef} className={styles.dialogForm} noValidate onSubmit={handleSubmit}>
      <h2 id={TITLE_ID} className={styles.dialogTitle}>
        {t("title")}
      </h2>
      <p className={styles.muted}>{t("detail")}</p>
      <PasswordField
        id={PASSWORD_ID}
        name="password"
        label={t("passwordLabel")}
        hint={t("passwordHint")}
        error={error}
        reserve={[t("passwordWrong"), t("passwordMissing")]}
        autoComplete="current-password"
        toggleSubject={t("passwordToggle")}
        onChange={() => setError(undefined)}
      />
      <div className={styles.dialogActions}>
        <Button type="submit" pending={isPending}>
          {isPending ? t("working") : t("submit")}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
