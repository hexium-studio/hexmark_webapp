"use client";

import { useTranslations } from "next-intl";
import { PasswordField } from "@/components/field/PasswordField";
import { RuleList } from "@/components/field/RuleList";
import { TextField } from "@/components/field/TextField";
import type { AccountFieldConfig, AccountFieldName } from "./account-form";
import { ACCOUNT_RULES, type AccountRuleStates } from "./account-rules";

// Labels of the account fields, e.g. for the list of fields that still
// block the submit button.
export function useAccountFieldLabel(): (name: AccountFieldName) => string {
  const t = useTranslations("setup.account.fields");
  return (name) => t(`${name}.label`);
}

export interface AccountFieldProps {
  field: AccountFieldConfig;
  rules: AccountRuleStates;
  // Already translated: an error the server reported, shown in place of the
  // rules, and the errors the field may receive, whose room is kept free.
  error?: string;
  reserve?: readonly string[];
}

// One input of the account step with its rule checklist as the hint.
export function AccountField({ field, rules, error, reserve }: AccountFieldProps) {
  const t = useTranslations("setup.account");
  const label = useAccountFieldLabel();
  const checklist = (
    <RuleList
      metLabel={t("rules.met")}
      rules={ACCOUNT_RULES[field.name].map((rule) => ({
        id: rule.id,
        text: t(`rules.${rule.id}`, rule.params),
        met: rules[rule.id],
      }))}
    />
  );
  const common = {
    id: `account-${field.name}`,
    name: field.name,
    label: label(field.name),
    hint: checklist,
    error,
    reserve,
    autoComplete: field.autoComplete,
  };
  if (field.name === "password" || field.name === "passwordConfirm") {
    return <PasswordField {...common} toggleSubject={t(`fields.${field.name}.toggleSubject`)} />;
  }
  return (
    <TextField
      {...common}
      type={field.type ?? "text"}
      autoCapitalize={field.name === "displayName" ? "words" : "none"}
      spellCheck={false}
    />
  );
}
