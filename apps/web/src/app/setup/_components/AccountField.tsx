"use client";

import { useTranslations } from "next-intl";
import { PasswordField } from "@/components/field/PasswordField";
import { TextField } from "@/components/field/TextField";
import type { AccountFieldConfig, AccountFieldName } from "./account-form";

// Labels of the account fields, e.g. for the list of fields that still
// block the submit button.
export function useAccountFieldLabel(): (name: AccountFieldName) => string {
  const t = useTranslations("setup.account.fields");
  return (name) => t(`${name}.label`);
}

export interface AccountFieldProps {
  field: AccountFieldConfig;
  // Already translated.
  error?: string;
}

// One input of the account step with its texts from the messages.
export function AccountField({ field, error }: AccountFieldProps) {
  const t = useTranslations("setup.account.fields");
  const label = useAccountFieldLabel();
  const common = {
    id: `account-${field.name}`,
    name: field.name,
    label: label(field.name),
    error,
    autoComplete: field.autoComplete,
  };
  if (field.name === "password") {
    return (
      <PasswordField
        {...common}
        hint={t("password.hint")}
        toggleSubject={t("password.toggleSubject")}
      />
    );
  }
  if (field.name === "passwordConfirm") {
    return <PasswordField {...common} toggleSubject={t("passwordConfirm.toggleSubject")} />;
  }
  return (
    <TextField
      {...common}
      hint={t(`${field.name}.hint`)}
      type={field.type ?? "text"}
      autoCapitalize={field.name === "displayName" ? "words" : "none"}
      spellCheck={false}
    />
  );
}
