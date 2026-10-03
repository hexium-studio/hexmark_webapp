import type { ComponentProps } from "react";
import styles from "./Button.module.css";

export interface ButtonLinkProps extends ComponentProps<"a"> {
  variant?: "primary" | "secondary";
}

// A link that looks like a button, for navigation (a full page load).
export function ButtonLink({ variant = "primary", className, ...rest }: ButtonLinkProps) {
  const classes = [styles.button, styles[variant], className].filter(Boolean).join(" ");
  return <a className={classes} {...rest} />;
}
