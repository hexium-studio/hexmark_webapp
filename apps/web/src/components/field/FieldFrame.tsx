import type { ReactNode } from "react";
import styles from "./Field.module.css";
import { FieldError } from "./FieldError";

// Label, error and hint around one input (hint below the field,
// the error right under the field it concerns). The input itself is rendered by
// the caller with the attributes from fieldA11yProps(), so hint and error
// are announced together with the field.

export interface FieldFrameProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}

export function fieldA11yProps(id: string, hint: ReactNode, error: string | undefined) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return {
    id,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": error ? true : undefined,
  };
}

export function FieldFrame({ id, label, hint, error, children }: FieldFrameProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children}
      {error ? <FieldError id={`${id}-error`} message={error} /> : null}
      {hint ? (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
