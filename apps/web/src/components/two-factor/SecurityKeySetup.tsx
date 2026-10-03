"use client";

import { WEBAUTHN_NAME_LIMITS, webauthnNameSchema } from "@hexmark/shared";
import { startRegistration } from "@simplewebauthn/browser";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { TextField } from "@/components/field/TextField";
import { useFieldErrorText } from "@/components/field/use-field-error-text";
import type { FactorFailure } from "@/lib/two-factor/factor-result";
import { browserWebauthnError } from "@/lib/two-factor/webauthn-errors";
import { registerSecurityKey, securityKeyOptions } from "./actions";
import type { FactorContext } from "./factor-context";
import styles from "./SecurityKeySetup.module.css";
import { useFactorToast } from "./use-factor-toast";

export interface SecurityKeySetupProps {
  context: FactorContext;
  id: string;
  onAdded(recoveryCodes: string[] | null): void;
  // As in TotpSetup: refusals that end the whole flow.
  onFailure?(failure: FactorFailure): boolean;
  // Shown next to "Register", e.g. "Cancel".
  secondaryAction?: ReactNode;
}

// Registering a security key or passkey: the user names it, the server
// sends the options, the browser talks to the key (@simplewebauthn/browser)
// and its answer goes back to the server unchanged. "Register" stays
// disabled until the shared schema accepts the name; only a refusal by the
// server turns the field red. Render it only where WebAuthn is usable
// (KeySupportSlot.tsx).
export function SecurityKeySetup(props: SecurityKeySetupProps) {
  const { context, id, onAdded, onFailure } = props;
  const t = useTranslations("twoFactor.key");
  const fieldErrorText = useFieldErrorText();
  const showError = useFactorToast();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string>();
  const [isPending, startTransition] = useTransition();
  const valid = webauthnNameSchema.safeParse(name).success;

  function fail(failure: FactorFailure) {
    const field = failure.fields.name;
    if (field) return setNameError(fieldErrorText("keyName", field));
    if (onFailure?.(failure)) return;
    showError(failure.error);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || !valid) return;
    startTransition(async () => {
      const options = await securityKeyOptions(context);
      if (!options.ok) return fail(options);
      let response: unknown;
      try {
        response = await startRegistration({ optionsJSON: options.options });
      } catch (error) {
        return showError(browserWebauthnError(error));
      }
      const result = await registerSecurityKey(context, name, response);
      if (!result.ok) return fail(result);
      setName("");
      onAdded(result.recoveryCodes);
    });
  }

  return (
    <form className={styles.form} noValidate onSubmit={handleSubmit}>
      <TextField
        id={`${id}-name`}
        name="keyName"
        label={t("nameLabel")}
        hint={t("nameHint", { max: WEBAUTHN_NAME_LIMITS.max })}
        error={nameError}
        value={name}
        maxLength={WEBAUTHN_NAME_LIMITS.max}
        autoComplete="off"
        onChange={(event) => {
          setName(event.currentTarget.value);
          setNameError(undefined);
        }}
      />
      <div className={styles.actions}>
        <Button
          type="submit"
          disabled={!valid}
          pending={isPending}
          aria-describedby={valid ? undefined : `${id}-reason`}
        >
          {isPending ? t("registering") : t("register")}
        </Button>
        {props.secondaryAction}
        {valid ? null : (
          <span id={`${id}-reason`} className="visually-hidden">
            {t("nameMissing")}
          </span>
        )}
      </div>
    </form>
  );
}
