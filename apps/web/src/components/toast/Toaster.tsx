"use client";

import { useTranslations } from "next-intl";
import {
  type FocusEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import styles from "./Toast.module.css";
import { ToastAnnouncer } from "./ToastAnnouncer";
import { ToastItem } from "./ToastItem";
import {
  dismissToast,
  getServerToasts,
  getToasts,
  subscribeToasts,
  type ToastEntry,
} from "./toast-store";
import { useFlashToast } from "./use-flash-toast";

// Renders the toasts of the store (toast-store.ts). Mounted once, in the
// root layout, so toasts outlive client navigation and redirects.
// The stack is a fixed element and so a compositing layer: an accepted
// exception only while toasts are visible (UI-Richtlinien, Farbversatz-
// Diagnose section 2). Without toasts it is not rendered at all; only the
// empty, non-fixed live regions remain.
// Toasts never take focus. Someone who tabs into one and closes it (close
// button, action, Escape) gets focus back where they came from.
export function Toaster() {
  const t = useTranslations("toast");
  const entries = useSyncExternalStore(subscribeToasts, getToasts, getServerToasts);
  const stackRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useFlashToast();
  useDropOverflow(stackRef, entries);

  // Remembers where focus came from when it enters the stack.
  function handleFocus(event: FocusEvent<HTMLElement>) {
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !event.currentTarget.contains(from)) {
      returnFocus.current = from;
    }
  }

  function dismiss(id: number, hadFocus: boolean) {
    dismissToast(id);
    if (!hadFocus) return;
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target?.isConnected) target.focus();
  }

  return (
    <>
      <ToastAnnouncer entries={entries} />
      {entries.length > 0 ? (
        <section
          ref={stackRef}
          className={styles.stack}
          aria-label={t("region")}
          onFocus={handleFocus}
        >
          <ol className={styles.list}>
            {entries.map((entry) => (
              <ToastItem key={entry.id} entry={entry} onDismiss={dismiss} />
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}

// Newest on top: when the stack is taller than the window allows
// (max-block-size in Toast.module.css), the oldest toasts at the bottom
// drop out. The newest always stays; if even it does not fit (tiny window,
// large text) the stack scrolls instead of cutting it off.
function useDropOverflow(stackRef: RefObject<HTMLElement | null>, entries: readonly ToastEntry[]) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: measures again whenever the toasts change
  useLayoutEffect(() => {
    function drop() {
      const stack = stackRef.current;
      if (!stack) return;
      // Nothing overflows: keep all. Sizes are fractional, offset* values
      // rounded, hence the pixel of tolerance on both checks.
      if (stack.scrollHeight <= stack.clientHeight + 1) return;
      const limit = stack.getBoundingClientRect().top + stack.clientHeight + 1;
      const items = [...stack.querySelectorAll<HTMLElement>("[data-toast-id]")];
      for (const item of items.slice(1)) {
        if (item.getBoundingClientRect().bottom > limit) {
          dismissToast(Number(item.dataset.toastId));
        }
      }
    }
    drop();
    window.addEventListener("resize", drop);
    return () => window.removeEventListener("resize", drop);
  }, [stackRef, entries]);
}
