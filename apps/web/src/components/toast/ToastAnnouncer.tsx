"use client";

import { useTranslations } from "next-intl";
import type { ToastEntry, ToastType } from "./toast-store";

const POLITE: ReadonlySet<ToastType> = new Set(["success", "info"]);

// The live regions for screen readers. They are always in the DOM, empty
// while there is nothing to say, so a toast added later is announced
// reliably (a region inserted together with its text often is not). The
// visible stack (Toaster) exists only while toasts are shown, because a
// fixed element is a compositing layer.
// success/info are polite (role="status"), warning/error interrupt
// (role="alert"). Each line is keyed by id and count, so a repeated message
// is a new line and announced again.
export function ToastAnnouncer({ entries }: { entries: readonly ToastEntry[] }) {
  const t = useTranslations("toast");

  function line(entry: ToastEntry): string {
    const title = /[.!?]$/.test(entry.title) ? entry.title : `${entry.title}.`;
    const repeated = entry.count > 1 ? `(${t("repeated", { count: entry.count })})` : "";
    return [t(`prefix.${entry.type}`), title, entry.message ?? "", repeated]
      .filter(Boolean)
      .join(" ");
  }

  const lines = (polite: boolean) =>
    entries
      .filter((entry) => POLITE.has(entry.type) === polite)
      .map((entry) => <p key={`${entry.id}-${entry.count}`}>{line(entry)}</p>);

  return (
    <>
      <div role="status" className="visually-hidden">
        {lines(true)}
      </div>
      <div role="alert" className="visually-hidden">
        {lines(false)}
      </div>
    </>
  );
}
