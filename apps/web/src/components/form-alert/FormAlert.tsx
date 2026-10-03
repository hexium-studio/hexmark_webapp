import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import styles from "./FormAlert.module.css";

export interface FormAlertProps {
  // "error" and "warning" are announced immediately (role="alert"); "info"
  // politely.
  tone?: "error" | "warning" | "info";
  title: string;
  children?: ReactNode;
  // Buttons or links that resolve the problem.
  actions?: ReactNode;
}

// Message about a form as a whole (not tied to a single field). Render it
// with a changing `key` to announce the same message again.
export function FormAlert({ tone = "error", title, children, actions }: FormAlertProps) {
  const t = useTranslations("formAlert");
  return (
    <div className={`${styles.alert} ${styles[tone]}`} role={tone === "info" ? "status" : "alert"}>
      <p className={styles.title}>
        <span className="visually-hidden">{t(`${tone}Prefix`)} </span>
        {title}
      </p>
      {children ? <div className={styles.body}>{children}</div> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
