"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { useFieldErrorText } from "@/components/field/use-field-error-text";
import { FormAlert } from "@/components/form-alert/FormAlert";
import { AccountField, useAccountFieldLabel } from "./AccountField";
import {
  ACCOUNT_FIELDS,
  type AccountErrors,
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
// token step; on success the server action redirects to /setup/complete and
// queues the "Admin account created" toast for that page (flash toast).
// Field rule errors and taken names stay at their fields; problems of the
// request as a whole (token no longer valid, too many attempts, server or
// database down, server error) are error toasts.
// "Create admin account" stays disabled until the shared schema accepts every
// field. `errors` holds the codes of a submit attempt (e.g. a username the
// server reports as taken); they win over the live ones until edited.
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
      if (result.ok) return;
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
      onBlur={(event) => {
        const target: EventTarget = event.target;
        if (target instanceof HTMLInputElement) validation.markLeft(target.name);
      }}
    >
      <div className={styles.fields}>
        <div className={styles.fieldGrid}>
          {ACCOUNT_FIELDS.map((field) => {
            const error = errors[field.name] ?? validation.visibleError(field.name);
            return (
              <div key={field.name} className={field.wide ? styles.wide : undefined}>
                <AccountField
                  field={field}
                  error={error ? fieldErrorText(field.name, error) : undefined}
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
        {validation.blocked ? (
          <p id={SUBMIT_HINT_ID} className={styles.note}>
            {t("account.blocked", {
              fields: format.list(validation.incomplete.map(fieldLabel), { type: "conjunction" }),
            })}
          </p>
        ) : null}
      </div>
    </form>
  );
}
