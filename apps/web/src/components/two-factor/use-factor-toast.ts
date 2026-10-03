"use client";

import { useTranslations } from "next-intl";
import { type ToastAction, type ToastType, toast } from "@/components/toast/toast-store";
import type { FactorMessageCode } from "@/lib/two-factor/factor-result";

export interface FactorToastOptions {
  // Error unless stated; e.g. "info" for a challenge that ran out.
  type?: ToastType;
  // Adds "N more attempts" after a wrong code at sign-in.
  attemptsRemaining?: number;
  action?: ToastAction;
}

// Toast for a refusal of a second-factor step (messages
// "twoFactor.errors.<code>.title" and ".detail"). The field-level part of
// such a refusal (a wrong code) is shown at the field by the caller.
export function useFactorToast() {
  const t = useTranslations("twoFactor.errors");
  return (code: FactorMessageCode, options: FactorToastOptions = {}) => {
    const detail = t(`${code}.detail`);
    const left = options.attemptsRemaining;
    const message =
      left !== undefined && left > 0 ? `${detail} ${t("attemptsLeft", { count: left })}` : detail;
    toast[options.type ?? "error"]({
      title: t(`${code}.title`),
      message,
      action: options.action,
    });
  };
}
