"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import styles from "./Field.module.css";
import { FieldFrame, fieldA11yProps } from "./FieldFrame";
import type { TextFieldProps } from "./TextField";

export interface PasswordFieldProps extends Omit<TextFieldProps, "type"> {
  // Completes the toggle's accessible name: "Show" + " password".
  toggleSubject: string;
}

// Password input with a button that reveals the typed value.
export function PasswordField({
  id,
  label,
  hint,
  error,
  toggleSubject,
  ...rest
}: PasswordFieldProps) {
  const t = useTranslations("field");
  const [visible, setVisible] = useState(false);
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <div className={styles.inputRow}>
        <input
          type={visible ? "text" : "password"}
          className={styles.input}
          spellCheck={false}
          autoCapitalize="off"
          {...fieldA11yProps(id, hint, error)}
          {...rest}
        />
        <button
          type="button"
          className={styles.toggle}
          aria-controls={id}
          onClick={() => setVisible((current) => !current)}
        >
          {t(visible ? "hide" : "show")}
          <span className="visually-hidden">{t("toggleSuffix", { subject: toggleSubject })}</span>
        </button>
      </div>
    </FieldFrame>
  );
}
