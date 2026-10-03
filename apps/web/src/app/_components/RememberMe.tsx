"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/checkbox/Checkbox";

// "Remember me" of the sign-in form, read with FormData.
export function RememberMe() {
  const t = useTranslations("auth.fields.remember");
  return <Checkbox name="remember" label={t("label")} />;
}
