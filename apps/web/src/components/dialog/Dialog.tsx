"use client";

import { type ReactNode, useEffect, useRef } from "react";
import styles from "./Dialog.module.css";

export interface DialogProps {
  open: boolean;
  // Id of the dialog's heading (rendered in `children`), its accessible name.
  labelledBy: string;
  // Escape, the close request of the browser, or the caller's own buttons.
  onClose(): void;
  children: ReactNode;
}

// A modal dialog on the native <dialog> element (showModal): the rest of
// the page becomes inert, so focus stays inside; Escape closes it; focus
// goes back to where it was when the dialog opened. The dialog sits in the
// browser's top layer, which is a compositing layer of its own: an allowed
// exception while it is open, like toasts (Farbversatz-Diagnose, section 2).
// Closed, it is not rendered at all.
export function Dialog({ open, labelledBy, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement ? active : null;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      const target = returnFocus.current;
      returnFocus.current = null;
      if (target?.isConnected) target.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        // Escape: the caller decides (and unmounts), so state and DOM agree.
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
