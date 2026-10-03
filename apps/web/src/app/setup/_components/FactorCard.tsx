import type { ReactNode } from "react";
import { StatusIcon } from "@/components/status-icon/StatusIcon";
import styles from "./FactorCard.module.css";

export interface FactorCardProps {
  title: string;
  description: string;
  // The factor is set up; the status line gets a check mark.
  done: boolean;
  status: string;
  children?: ReactNode;
}

// One kind of second factor in setup step 5: heading, what it is, whether
// it is set up (text and mark, not colour alone), then its controls.
export function FactorCard({ title, description, done, status, children }: FactorCardProps) {
  return (
    <section className={styles.card} aria-label={title}>
      <div className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.status} data-done={done || undefined}>
          {done ? <StatusIcon kind="pass" className={styles.icon} /> : null}
          <span>{status}</span>
        </p>
      </div>
      <p className={styles.description}>{description}</p>
      {children}
    </section>
  );
}
