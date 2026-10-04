"use client";

import { useTranslations } from "next-intl";
import { toast } from "@/components/toast/toast-store";
import type { TokenErrorCode } from "@/lib/api-tokens/token-result";
import type { FactorMessageCode } from "@/lib/two-factor/factor-result";

// Error toast for a refusal on the token page: the token API's codes and
// those of the password confirmation ("tokens.errors.<code>.title" and
// ".detail"). A code without its own text gets the "unexpected" one.
export function useTokenToast() {
  const t = useTranslations("tokens.errors");
  return (code: TokenErrorCode | FactorMessageCode) => {
    // Codes arrive at run time; t.has checks the key.
    const key = (
      t.has(`${code}.title` as "unexpected.title") ? code : "unexpected"
    ) as "unexpected";
    toast.error({ title: t(`${key}.title`), message: t(`${key}.detail`) });
  };
}
