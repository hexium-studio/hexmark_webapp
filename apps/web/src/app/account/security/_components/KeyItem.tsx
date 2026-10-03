"use client";

import {
  WEBAUTHN_NAME_LIMITS,
  type WebauthnCredentialSummary,
  webauthnNameSchema,
} from "@hexmark/shared";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { TextField } from "@/components/field/TextField";
import { useFieldErrorText } from "@/components/field/use-field-error-text";
import { toast } from "@/components/toast/toast-store";
import { useFactorToast } from "@/components/two-factor/use-factor-toast";
import { renameSecurityKey } from "./account-actions";
import styles from "./Security.module.css";

export interface KeyItemProps {
  credential: WebauthnCredentialSummary;
  timeZone: string;
  // False while it is the last factor of an account that must have one.
  removable: boolean;
  onRemove(): void;
}

// One security key: its full name (wrapped, never cut off), when it was
// added and last used, and the buttons to rename (in place) and remove it.
// The buttons' accessible names start with their visible text and add the
// key's name, so a list of "Remove" buttons stays distinguishable.
export function KeyItem({ credential, timeZone, removable, onRemove }: KeyItemProps) {
  const t = useTranslations("accountSecurity.keys");
  const format = useFormatter();
  const [renaming, setRenaming] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const wasRenaming = useRef(false);
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone });
  const lastFactorId = `key-${credential.id}-last`;

  // Back from the rename form: focus returns to "Rename".
  useEffect(() => {
    if (!renaming && wasRenaming.current) renameButton.current?.focus();
    wasRenaming.current = renaming;
  }, [renaming]);

  if (renaming) {
    return (
      <li className={styles.key}>
        <RenameForm credential={credential} onClose={() => setRenaming(false)} />
      </li>
    );
  }
  return (
    <li className={styles.key}>
      <p className={styles.keyName}>{credential.name}</p>
      <p className={styles.keyMeta}>
        <span>{t("addedOn", { date: when(credential.createdAt) })}</span>
        <span>
          {credential.lastUsedAt
            ? t("lastUsed", { date: when(credential.lastUsedAt) })
            : t("neverUsed")}
        </span>
      </p>
      <div className={styles.actions}>
        <Button ref={renameButton} variant="secondary" onClick={() => setRenaming(true)}>
          {t("rename")}
          <span className="visually-hidden"> {credential.name}</span>
        </Button>
        <Button
          variant="secondary"
          disabled={!removable}
          aria-describedby={removable ? undefined : lastFactorId}
          onClick={onRemove}
        >
          {t("remove")}
          <span className="visually-hidden"> {credential.name}</span>
        </Button>
      </div>
      {removable ? null : (
        <p id={lastFactorId} className={styles.note}>
          {t("lastFactor")}
        </p>
      )}
    </li>
  );
}

function RenameForm(props: { credential: WebauthnCredentialSummary; onClose(): void }) {
  const { credential, onClose } = props;
  const t = useTranslations("accountSecurity.keys");
  const router = useRouter();
  const showError = useFactorToast();
  const fieldErrorText = useFieldErrorText();
  const [name, setName] = useState(credential.name);
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();
  const valid = webauthnNameSchema.safeParse(name).success && name.trim() !== credential.name;
  const fieldId = `rename-${credential.id}`;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || !valid) return;
    startTransition(async () => {
      const result = await renameSecurityKey(credential.id, name);
      if (result.ok) {
        toast.success({ title: t("renamed") });
        onClose();
        return router.refresh();
      }
      const field = result.fields.name;
      if (field) return setError(fieldErrorText("keyName", field));
      showError(result.error);
      router.refresh();
    });
  }

  return (
    <form className={styles.rename} noValidate onSubmit={handleSubmit}>
      <TextField
        id={fieldId}
        name="keyName"
        label={t("renameLabel", { name: credential.name })}
        hint={t("renameHint", { max: WEBAUTHN_NAME_LIMITS.max })}
        error={error}
        value={name}
        maxLength={WEBAUTHN_NAME_LIMITS.max}
        autoComplete="off"
        // The field replaces the button that was just pressed.
        autoFocus
        onChange={(event) => {
          setName(event.currentTarget.value);
          setError(undefined);
        }}
      />
      <div className={styles.actions}>
        <Button type="submit" disabled={!valid} pending={isPending}>
          {t("save")}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
