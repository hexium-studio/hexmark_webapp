"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/button/Button";
import { FormAlert } from "@/components/form-alert/FormAlert";

export interface NoMethodAlertProps {
  // The account has security keys only, and this browser cannot use them.
  keyOnly: boolean;
  // "enrolment": nothing can be set up here (forced enrolment).
  kind?: "sign-in" | "enrolment";
  onBack(): void;
}

// The account cannot finish signing in here: no second factor it has (or
// could set up) is usable on this page. Says why and whom to ask, instead of
// leaving the user in front of a step without controls.
export function NoMethodAlert({ keyOnly, kind = "sign-in", onBack }: NoMethodAlertProps) {
  const t = useTranslations("secondFactor.noMethod");
  const key = kind === "enrolment" ? "enrolment" : keyOnly ? "keyOnly" : "none";
  return (
    <FormAlert
      title={t(`${key}.title`)}
      actions={
        <Button variant="secondary" onClick={onBack}>
          {t("back")}
        </Button>
      }
    >
      <p>{t(`${key}.detail`)}</p>
    </FormAlert>
  );
}
