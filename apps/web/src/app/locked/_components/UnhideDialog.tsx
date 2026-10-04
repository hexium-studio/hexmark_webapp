"use client";

import type { HiddenItem } from "@hexmark/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { Dialog } from "@/components/dialog/Dialog";
import { PasswordField } from "@/components/field/PasswordField";
import { reauthenticate } from "@/components/reauthentication/actions";
import { isRecentlyConfirmed } from "@/components/reauthentication/recent";
import { toast } from "@/components/toast/toast-store";
import { useFactorToast } from "@/components/two-factor/use-factor-toast";
import styles from "./Locked.module.css";
import { unhideItem } from "./locked-actions";

const TITLE_ID = "unhide-dialog-title";
const PASSWORD_ID = "unhide-password";
const LIST_ID = "hidden-list";
const KNOWN_ERRORS = ["unauthenticated", "forbidden", "not_found", "folder_not_found"];

export interface UnhideDialogProps {
  // The item to unhide; null: closed.
  item: HiddenItem | null;
  reauthenticatedUntil: string | null;
  onReauthenticated(until: string): void;
  onClose(): void;
}

// Confirms unhiding in a modal dialog: the item spelled out in full, what
// unhiding does (agents can read it again; a lock stays) and - when the
// last confirmation is older than 10 minutes - the password. The server
// decides that again (reauthentication_required asks for the password
// here). A wrong password is an error at the field; other refusals close
// the dialog and become a toast. Afterwards the page is loaded again and
// the focus goes to the hidden list's heading.
export function UnhideDialog(props: UnhideDialogProps) {
  return (
    <Dialog open={props.item !== null} labelledBy={TITLE_ID} onClose={props.onClose}>
      {props.item ? <DialogBody {...props} item={props.item} /> : null}
    </Dialog>
  );
}

function DialogBody(props: UnhideDialogProps & { item: HiddenItem }) {
  const { item, onClose } = props;
  const t = useTranslations("locked.hidden");
  const tl = useTranslations("locked");
  const router = useRouter();
  const showFactorError = useFactorToast();
  const [needPassword, setNeedPassword] = useState(
    () => !isRecentlyConfirmed(props.reauthenticatedUntil),
  );
  const [passwordError, setPasswordError] = useState<string>();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const focus = (selector: string) =>
    formRef.current?.querySelector<HTMLElement>(selector)?.focus();

  // First stop: the password when it is asked for, else the safe "Cancel".
  useEffect(() => {
    const target = needPassword ? `#${PASSWORD_ID}` : "button[data-cancel]";
    formRef.current?.querySelector<HTMLElement>(target)?.focus();
  }, [needPassword]);

  function finish(ok: boolean, error?: string) {
    onClose();
    if (ok) {
      toast.success({ title: t("done", { path: item.path }) });
    } else {
      const code = KNOWN_ERRORS.includes(error ?? "") ? error : "unexpected";
      const scope = code === "forbidden" ? "hidden.errors" : "errors";
      toast.error({
        title: tl(`${scope}.${code}.title` as "errors.unexpected.title"),
        message: tl(`${scope}.${code}.detail` as "errors.unexpected.detail"),
      });
    }
    router.refresh();
    requestAnimationFrame(() => document.getElementById(LIST_ID)?.focus());
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    if (needPassword && password === "") return setPasswordError(t("confirm.passwordMissing"));
    startTransition(async () => {
      if (needPassword) {
        const confirmed = await reauthenticate(password);
        if (!confirmed.ok) {
          if (confirmed.error === "invalid_password") {
            setPasswordError(t("confirm.passwordWrong"));
            return focus(`#${PASSWORD_ID}`);
          }
          onClose();
          return showFactorError(confirmed.error);
        }
        props.onReauthenticated(confirmed.until);
      }
      const result = await unhideItem(item.kind, item.id);
      if (!result.ok && result.error === "reauthentication_required") return setNeedPassword(true);
      finish(result.ok, result.ok ? undefined : result.error);
    });
  }

  return (
    <form ref={formRef} className={styles.dialogForm} noValidate onSubmit={handleSubmit}>
      <h2 id={TITLE_ID} className={styles.dialogTitle}>
        {t("confirm.title")}
      </h2>
      <p className={styles.subject}>{item.path}</p>
      <p className={styles.muted}>
        {item.kind === "folder" ? t("confirm.detailFolder") : t("confirm.detail")}
      </p>
      {needPassword ? (
        <PasswordField
          id={PASSWORD_ID}
          name="password"
          label={t("confirm.passwordLabel")}
          hint={t("confirm.passwordHint")}
          error={passwordError}
          reserve={[t("confirm.passwordWrong"), t("confirm.passwordMissing")]}
          autoComplete="current-password"
          toggleSubject={t("confirm.passwordToggle")}
          onChange={() => setPasswordError(undefined)}
        />
      ) : null}
      <div className={styles.dialogActions}>
        <Button type="submit" pending={isPending}>
          {isPending ? t("working") : t("confirm.submit")}
        </Button>
        <Button variant="secondary" data-cancel onClick={onClose}>
          {t("confirm.cancel")}
        </Button>
      </div>
    </form>
  );
}
