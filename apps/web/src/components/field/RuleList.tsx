import styles from "./RuleList.module.css";

// The rules of a field as a checklist, shown as its hint (FieldFrame). A met
// rule turns green with a check mark and says "met" to screen readers; an
// open one stays neutral with an empty circle, so the state never depends on
// colour alone. The list is no live region: it is read with the field
// whenever the field gets focus, and announcing it on every keystroke would
// drown out the typing.

export interface FieldRule {
  id: string;
  // Already translated.
  text: string;
  met: boolean;
}

export interface RuleListProps {
  rules: readonly FieldRule[];
  // Visually hidden after a met rule, e.g. "(met)".
  metLabel: string;
}

function RuleIcon({ met }: { met: boolean }) {
  return (
    <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {met ? (
        <path
          d="M5 8.25 7.1 10.3 11 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}

export function RuleList({ rules, metLabel }: RuleListProps) {
  return (
    <ul className={styles.rules}>
      {rules.map((rule) => (
        <li key={rule.id} className={styles.rule} data-met={rule.met || undefined}>
          <RuleIcon met={rule.met} />
          <span>
            {rule.text}
            {rule.met ? <span className="visually-hidden"> {metLabel}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
