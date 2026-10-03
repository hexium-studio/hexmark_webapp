import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { StatusIcon } from "../status-icon/StatusIcon";
import styles from "./CheckStatus.module.css";

export type CheckState = "pass" | "fail" | "unknown";

export interface CheckStatusProps {
  label: string;
  state: CheckState;
  detail?: ReactNode;
}

// One line of a checklist, e.g. "Database: Passed". The state is always
// spelled out; colour and icon only repeat it.
export function CheckStatus({ label, state, detail }: CheckStatusProps) {
  const t = useTranslations("checkStatus");
  return (
    <div className={`${styles.check} ${styles[state]}`}>
      <StatusIcon kind={state} className={styles.icon} />
      <div className={styles.text}>
        <p className={styles.headline}>
          <span>{label}:</span> <span className={styles.state}>{t(state)}</span>
        </p>
        {detail ? <p className={styles.detail}>{detail}</p> : null}
      </div>
    </div>
  );
}
