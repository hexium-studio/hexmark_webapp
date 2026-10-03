import type { ReactNode } from "react";
import styles from "./InstructionList.module.css";

// Numbered steps someone carries out outside the app (edit .env, restart),
// as one card with dividers. A plain ordered list for screen readers; the
// circled numbers are drawn by CSS.
export function InstructionList({ items }: { items: readonly ReactNode[] }) {
  return (
    <ol className={styles.list}>
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed texts in a fixed order, never reordered
        <li key={index}>{item}</li>
      ))}
    </ol>
  );
}
