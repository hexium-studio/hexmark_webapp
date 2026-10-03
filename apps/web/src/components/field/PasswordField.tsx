"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FieldFrame, fieldA11yProps } from "./FieldFrame";
import styles from "./PasswordField.module.css";
import type { TextFieldProps } from "./TextField";

export interface PasswordFieldProps extends Omit<TextFieldProps, "type"> {
  // Completes the toggle's accessible name: "Show" + "password".
  toggleSubject: string;
}

// Eye (value hidden, press to show) and crossed-out eye (value shown).
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M1.75 10S4.75 4.25 10 4.25 18.25 10 18.25 10 15.25 15.75 10 15.75 1.75 10 1.75 10Z" />
        <circle cx="10" cy="10" r="2.75" />
        {crossed ? <path d="M3.25 2.75 16.75 17.25" /> : null}
      </g>
    </svg>
  );
}

// Password input with an icon button at its inline end that reveals the
// typed value. The button keeps one name ("Show password") and reports its
// state with aria-pressed; the icon changes with it.
export function PasswordField({
  id,
  label,
  hint,
  error,
  reserve,
  toggleSubject,
  ...rest
}: PasswordFieldProps) {
  const t = useTranslations("field");
  const [visible, setVisible] = useState(false);
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} reserve={reserve}>
      <div className={styles.control}>
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
          aria-pressed={visible}
          aria-label={t("reveal", { subject: toggleSubject })}
          onClick={() => setVisible((current) => !current)}
        >
          <EyeIcon crossed={visible} />
        </button>
      </div>
    </FieldFrame>
  );
}
