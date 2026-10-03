import type { ReactNode } from "react";
import styles from "./Field.module.css";
import { FieldError } from "./FieldError";

// Label, input and the message slot below it. The input itself is rendered
// by the caller with the attributes from fieldA11yProps(), so the slot's
// current content is read with the field.
//
// The slot holds the hint (a text or a rule list) or, in its place, an
// error. All of them sit in the same grid cell; the one not shown stays
// there invisibly, so the slot is always as tall as the taller of the two
// and nothing below the field moves when an error comes or goes. `reserve`
// lists further errors the field may receive later (e.g. "already taken"
// from the server), kept invisibly in the cell for the same reason.

export interface FieldFrameProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  // Already translated.
  reserve?: readonly string[];
  children: ReactNode;
}

export function fieldA11yProps(id: string, hint: ReactNode, error: string | undefined) {
  // Only what is visible: an error replaces the hint for screen readers too.
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
  };
}

export function FieldFrame({ id, label, hint, error, reserve = [], children }: FieldFrameProps) {
  const hasSlot = Boolean(hint) || Boolean(error) || reserve.length > 0;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children}
      {hasSlot ? (
        <div className={styles.slot}>
          {hint ? (
            <div id={`${id}-hint`} className={`${styles.hint} ${error ? styles.concealed : ""}`}>
              {hint}
            </div>
          ) : null}
          {error ? <FieldError id={`${id}-error`} message={error} /> : null}
          {reserve
            .filter((text) => text !== error)
            .map((text) => (
              <div key={text} className={styles.concealed} aria-hidden="true">
                <FieldError message={text} />
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}
