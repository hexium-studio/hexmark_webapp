import type { ComponentProps, ReactNode } from "react";
import styles from "./Field.module.css";
import { FieldFrame, fieldA11yProps } from "./FieldFrame";

export interface TextFieldProps
  extends Omit<ComponentProps<"input">, "id" | "aria-describedby" | "aria-invalid"> {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
}

export function TextField({ id, label, hint, error, type = "text", ...rest }: TextFieldProps) {
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <input type={type} className={styles.input} {...fieldA11yProps(id, hint, error)} {...rest} />
    </FieldFrame>
  );
}
