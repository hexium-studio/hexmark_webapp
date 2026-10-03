import type { ComponentProps } from "react";
import styles from "./Button.module.css";

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: "primary" | "secondary";
  // Shows the button as busy. It stays focusable (unlike `disabled`, which
  // would drop keyboard focus mid-submit); the caller ignores repeat clicks.
  pending?: boolean;
}

export function Button({
  variant = "primary",
  pending = false,
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[variant], className].filter(Boolean).join(" ");
  return (
    <button
      type={type}
      className={classes}
      aria-disabled={pending || undefined}
      data-pending={pending || undefined}
      {...rest}
    />
  );
}
