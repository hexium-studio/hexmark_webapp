"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Button } from "@/components/button/Button";
import { FormAlert } from "@/components/form-alert/FormAlert";

export interface SkipConfirmationProps {
  onSkip(): void;
  onStay(): void;
}

// Asked before step 5 is skipped: without a second factor the admin account
// rests on its password alone. Focus moves to the safe choice.
export function SkipConfirmation({ onSkip, onStay }: SkipConfirmationProps) {
  const t = useTranslations("setup.twoFactor.skipConfirm");
  const stayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    stayRef.current?.focus();
  }, []);

  return (
    <FormAlert
      tone="warning"
      title={t("title")}
      actions={
        <>
          <Button ref={stayRef} onClick={onStay}>
            {t("stay")}
          </Button>
          <Button variant="secondary" onClick={onSkip}>
            {t("skip")}
          </Button>
        </>
      }
    >
      <p>{t("detail")}</p>
    </FormAlert>
  );
}
