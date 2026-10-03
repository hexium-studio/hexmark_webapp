"use client";

import { useTranslations } from "next-intl";
import { type CSSProperties, useRef } from "react";
import styles from "./Toast.module.css";
import { CloseIcon, ToastIcon } from "./ToastIcon";
import { TOAST_DURATION_MS, type ToastEntry } from "./toast-store";

export interface ToastItemProps {
  entry: ToastEntry;
  // `hadFocus`: focus was inside the toast, so the Toaster puts it back.
  onDismiss(id: number, hadFocus: boolean): void;
}

// One toast. Its time is the CSS animation of the progress bar: the bar's
// `animationend` closes the toast, and pausing the animation on hover or
// focus (Toast.module.css) pauses the time, which then resumes with what
// was left. The bar is keyed by `count`, so a repeated message restarts it.
export function ToastItem({ entry, onDismiss }: ToastItemProps) {
  const t = useTranslations("toast");
  const ref = useRef<HTMLLIElement>(null);
  const { id, type, title, message, action, count } = entry;
  const duration = TOAST_DURATION_MS[type];

  function dismiss() {
    onDismiss(id, ref.current?.contains(document.activeElement) ?? false);
  }

  const timing = {
    "--toast-duration": `${duration}ms`,
    // Reduced motion: one step per second instead of a gliding bar.
    "--toast-steps": Math.round(duration / 1000),
  } as CSSProperties;

  return (
    <li
      ref={ref}
      className={styles.toast}
      data-type={type}
      data-toast-id={id}
      // Escape closes the toast that has focus (its close or action button).
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        dismiss();
      }}
    >
      <ToastIcon type={type} className={styles.icon} />
      <p className={styles.title}>
        <span className="visually-hidden">{t(`prefix.${type}`)} </span>
        {title}
        {count > 1 ? (
          <span className={styles.count}>
            <span aria-hidden="true">{count}×</span>
            <span className="visually-hidden">{t("repeated", { count })}</span>
          </span>
        ) : null}
      </p>
      {message || action ? (
        <div className={styles.content}>
          {message ? <p className={styles.message}>{message}</p> : null}
          {action ? (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                dismiss();
                action.onClick();
              }}
            >
              {action.label}
            </button>
          ) : null}
        </div>
      ) : null}
      {/* Last in reading and tab order; drawn in the top corner (grid area). */}
      <button type="button" className={styles.close} aria-label={t("dismiss")} onClick={dismiss}>
        <CloseIcon className={styles.closeIcon} />
      </button>
      <div className={styles.track} aria-hidden="true">
        <div
          key={count}
          className={styles.bar}
          style={timing}
          onAnimationEnd={() => onDismiss(id, false)}
        />
      </div>
    </li>
  );
}
