"use client";

import { useTranslations } from "next-intl";
import { PasswordField } from "@/components/field/PasswordField";
import { TextField } from "@/components/field/TextField";
import styles from "./SignIn.module.css";

// E-mail and password of the sign-in form, uncontrolled (the form reads
// them with FormData). Neither has a hint or an error, so neither has a
// message slot: nothing below them can move.
export function SignInFields() {
  const t = useTranslations("auth.fields");
  return (
    <div className={styles.fields}>
      <TextField
        id="sign-in-email"
        name="email"
        type="email"
        label={t("email.label")}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
      />
      <PasswordField
        id="sign-in-password"
        name="password"
        label={t("password.label")}
        autoComplete="current-password"
        toggleSubject={t("password.toggleSubject")}
      />
    </div>
  );
}
