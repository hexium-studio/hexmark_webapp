"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { useFieldErrorText } from "@/components/field/use-field-error-text";
import { FormAlert } from "@/components/form-alert/FormAlert";
import { toast } from "@/components/toast/toast-store";
import { AccountField, useAccountFieldLabel } from "./AccountField";
import {
  ACCOUNT_FIELDS,
  type AccountErrors,
  type AccountFieldName,
  firstInvalidField,
  readAccountValues,
  splitFieldErrors,
  validateAccount,
} from "./account-form";
import { createAdmin } from "./actions";
import styles from "./Step.module.css";
import { useSetupErrorToast } from "./setup-errors";
import { useAccountValidation } from "./use-account-validation";
import type { StepProps } from "./wizard-types";

const SUBMIT_HINT_ID = "account-submit-hint";

// The first admin account. Submits together with the token verified in the
// token step; on success the server action keeps the setup ticket for the
// next steps (challenge cookie) and the wizard moves on to step 5 with an
// "Admin account created" toast.
// Each field shows its rules as a checklist that follows the typing; nothing
// turns red while typing or on leaving a field. "Create admin account" stays
// disabled until the shared schema accepts every field, so red errors come
// from the server (a username or e-mail address already taken) and take the
// checklist's place. Problems of the request as a whole (token no longer
// valid, too many attempts, server or database down, server error) are error
// toasts. `errors` holds the codes of a submit attempt; editing a field
// clears its own.
export function AccountStep({ wizard }: StepProps) {
  const t = useTranslations("setup");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const locale = useLocale();
  const fieldErrorText = useFieldErrorText();
  const fieldLabel = useAccountFieldLabel();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<AccountErrors>({});
  const [focusRequest, setFocusRequest] = useState(0);
  const showError = useSetupErrorToast(wizard);
  const [isPending, startTransition] = useTransition();
  const setupToken = wizard.data.setupToken;
  const validation = useAccountValidation(setupToken ?? "");

  // Focus the first invalid field after its error message is rendered, so
  // screen readers read the message with the field.
  useEffect(() => {
    if (focusRequest === 0) return;
    const name = firstInvalidField(errors);
    const element = name ? formRef.current?.elements.namedItem(name) : null;
    if (element instanceof HTMLInputElement) element.focus();
  }, [focusRequest, errors]);

  function showFieldErrors(next: AccountErrors) {
    setErrors(next);
    setFocusRequest((count) => count + 1);
  }

  function blockedNote(fields: readonly AccountFieldName[]) {
    return t("account.blocked", {
      fields: format.list(fields.map(fieldLabel), { type: "conjunction" }),
    });
  }

  function enterTokenAgain() {
    wizard.update({ setupToken: undefined });
    wizard.goTo("token");
  }

  // The token was accepted in step 2 but no longer is (e.g. changed on the
  // server); the toast leads back to step 2.
  function showTokenRejected() {
    showError("invalid_token", { label: t("account.enterTokenAgain"), onClick: enterTokenAgain });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || !setupToken) return;
    const values = readAccountValues(event.currentTarget);
    const validation = validateAccount(values, setupToken, locale);
    if (!validation.ok) {
      // A token problem cannot be fixed in this form.
      if (Object.keys(validation.errors).length === 0) return showTokenRejected();
      return showFieldErrors(validation.errors);
    }
    startTransition(async () => {
      const result = await createAdmin(validation.input);
      if (result.ok) {
        toast.success({ title: t("account.created.title"), message: t("account.created.detail") });
        wizard.update({ setupToken: undefined, adminEmail: validation.input.email });
        return wizard.next();
      }
      const { errors: fieldErrors } = splitFieldErrors(result.fields);
      if (Object.keys(fieldErrors).length > 0) return showFieldErrors(fieldErrors);
      // A 400 without field errors of this form concerns the token or the body.
      if (result.error === "invalid_token" || result.fields.setupToken) return showTokenRejected();
      showError(
        result.error === "validation" || result.error === "conflict" ? "unexpected" : result.error,
      );
      if (result.error === "setup_closed") router.refresh();
    });
  }

  if (!setupToken) {
    return (
      <FormAlert
        title={t("account.verifyFirst")}
        actions={<Button onClick={enterTokenAgain}>{t("account.enterToken")}</Button>}
      />
    );
  }

  return (
    <form
      ref={formRef}
      className={styles.form}
      noValidate
      onSubmit={handleSubmit}
      onChange={(event) => {
        validation.revalidate(event.currentTarget);
        // Editing a field clears its submit error.
        const target: EventTarget = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const { name } = target;
        setErrors((current) => (name in current ? { ...current, [name]: undefined } : current));
      }}
    >
      <div className={styles.fields}>
        <div className={styles.fieldGrid}>
          {ACCOUNT_FIELDS.map((field) => {
            const error = errors[field.name];
            return (
              <div key={field.name} className={field.wide ? styles.wide : undefined}>
                <AccountField
                  field={field}
                  rules={validation.rules}
                  error={error ? fieldErrorText(field.name, error) : undefined}
                  reserve={field.serverErrors?.map((code) => fieldErrorText(field.name, { code }))}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className={`${styles.actions} ${styles.actionsSpaced}`}>
        <Button variant="secondary" onClick={wizard.back}>
          {tCommon("back")}
        </Button>
        <Button
          type="submit"
          disabled={validation.blocked}
          pending={isPending}
          aria-describedby={validation.blocked ? SUBMIT_HINT_ID : undefined}
        >
          {isPending ? t("account.creating") : t("account.create")}
        </Button>
        {/* The one live region of the form: it changes only when a field
            becomes complete or incomplete, not on every keystroke. The
            longest wording (every field missing) stays invisibly in the same
            cell, so a shorter one never changes the height of the step. */}
        <div className={styles.noteSlot}>
          <p id={SUBMIT_HINT_ID} className={styles.note} aria-live="polite">
            {validation.blocked ? blockedNote(validation.incomplete) : t("account.ready")}
          </p>
          <p className={`${styles.note} ${styles.concealed}`} aria-hidden="true">
            {blockedNote(ACCOUNT_FIELDS.map((field) => field.name))}
          </p>
        </div>
      </div>
    </form>
  );
}
