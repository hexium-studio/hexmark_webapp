import type { ComponentProps, ReactNode } from "react";
import styles from "./Checkbox.module.css";

export interface CheckboxProps extends Omit<ComponentProps<"input">, "type" | "className"> {
  label: ReactNode;
}

// A real checkbox inside its label, so the whole row (at least 44 px high)
// toggles it, drawn like the text fields (Checkbox.module.css). Used for
// "Remember me" and for confirming that recovery codes are saved.
export function Checkbox({ label, ...rest }: CheckboxProps) {
  return (
    <label className={styles.label}>
      <input type="checkbox" className={styles.checkbox} {...rest} />
      <span>{label}</span>
    </label>
  );
}
