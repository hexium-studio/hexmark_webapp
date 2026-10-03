import { useTranslations } from "next-intl";
import { StatusIcon } from "../status-icon/StatusIcon";
import styles from "./StepList.module.css";

// Vertical progress list of a multi-step flow (setup wizard, later others).
// Not interactive: steps are reached in order. Each state is spelled out
// ("Done", "Current step", "Not started"); marker and colour only repeat it.

export type StepState = "done" | "current" | "todo";

export interface StepListItem {
  id: string;
  title: string;
  state: StepState;
}

export interface StepListProps {
  items: readonly StepListItem[];
  // Accessible name of the list.
  label: string;
}

export function StepList({ items, label }: StepListProps) {
  const t = useTranslations("stepList");
  return (
    <ol className={styles.list} aria-label={label}>
      {items.map((item, index) => (
        <li
          key={item.id}
          className={`${styles.item} ${styles[item.state]}`}
          aria-current={item.state === "current" ? "step" : undefined}
        >
          <span className={styles.marker} aria-hidden="true">
            {item.state === "done" ? <StatusIcon kind="pass" className={styles.icon} /> : index + 1}
          </span>
          <span className={styles.text}>
            <span className={styles.title}>
              <span className="visually-hidden">{t("stepPrefix", { number: index + 1 })} </span>
              {item.title}
            </span>
            <span className={styles.state}>
              <span className="visually-hidden">, </span>
              {t(item.state)}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
