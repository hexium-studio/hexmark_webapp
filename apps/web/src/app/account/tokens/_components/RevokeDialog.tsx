"use client";

import type { ApiTokenInfo } from "@hexmark/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { Dialog } from "@/components/dialog/Dialog";
import styles from "./Tokens.module.css";
import { revokeApiToken } from "./token-actions";
import { useTokenToast } from "./use-token-toast";

const TITLE_ID = "revoke-dialog-title";

export interface RevokeDialogProps {
  token: ApiTokenInfo | null;
  onClose(): void;
  onDone(): void;
}

// Confirms revoking a token, naming it in full (wrapped, never cut off).
// No password: revoking only takes access away. A refusal closes the
// dialog and becomes a toast; the list is loaded again.
export function RevokeDialog({ token, onClose, onDone }: RevokeDialogProps) {
  return (
    <Dialog open={token !== null} labelledBy={TITLE_ID} onClose={onClose}>
      {token ? <DialogBody token={token} onClose={onClose} onDone={onDone} /> : null}
    </Dialog>
  );
}

function DialogBody({ token, onClose, onDone }: RevokeDialogProps & { token: ApiTokenInfo }) {
  const t = useTranslations("tokens.revoke");
  const router = useRouter();
  const showError = useTokenToast();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // First stop: the safe "Cancel".
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("button[data-cancel]")?.focus();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    startTransition(async () => {
      const result = await revokeApiToken(token.id);
      if (result.ok) return onDone();
      onClose();
      showError(result.error);
      router.refresh();
    });
  }

  return (
    <form ref={formRef} className={styles.dialogForm} noValidate onSubmit={handleSubmit}>
      <h2 id={TITLE_ID} className={styles.dialogTitle}>
        {t("title")}
      </h2>
      <p className={styles.subject}>{token.name}</p>
      <p className={styles.muted}>{t("detail")}</p>
      <div className={styles.dialogActions}>
        <Button type="submit" pending={isPending}>
          {isPending ? t("working") : t("action")}
        </Button>
        <Button variant="secondary" data-cancel onClick={onClose}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
