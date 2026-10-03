import type { ComponentProps, ReactNode } from "react";
import styles from "./Field.module.css";
import { FieldFrame, fieldA11yProps } from "./FieldFrame";

export interface TextFieldProps
  extends Omit<ComponentProps<"input">, "id" | "aria-describedby" | "aria-invalid"> {
  id: string;
  label: string;
  // Shown in the slot under the field; an error takes the hint's place.
  hint?: ReactNode;
  error?: string;
  // Errors the field may show later; their room is kept free (FieldFrame).
  reserve?: readonly string[];
}

export function TextField({
  id,
  label,
  hint,
  error,
  reserve,
  type = "text",
  ...rest
}: TextFieldProps) {
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} reserve={reserve}>
      <input type={type} className={styles.input} {...fieldA11yProps(id, hint, error)} {...rest} />
    </FieldFrame>
  );
}
