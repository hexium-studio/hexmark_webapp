"use client";

import type { LockedItem } from "@hexmark/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { toast } from "@/components/toast/toast-store";
import { ItemFacts } from "./ItemFacts";
import styles from "./Locked.module.css";
import { unlockItem } from "./locked-actions";

export const LOCKED_LIST_ID = "locked-list";
const KNOWN_ERRORS = ["unauthenticated", "forbidden", "not_found", "folder_not_found"];

// The notes and folders with a lock of their own, by path: who locked it,
// when, why, and for a folder how much below it the lock covers. "Unlock"
// lifts it at once - no password: unlocking gives nobody more access (people
// may change locked items anyway), it is logged, and locking again undoes
// it. Afterwards the page is loaded again and the focus goes to the list's
// heading.
export function LockedSection({ items, timezone }: { items: LockedItem[]; timezone: string }) {
  const t = useTranslations("locked");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function unlock(item: LockedItem) {
    if (isPending) return;
    setBusy(item.id);
    startTransition(async () => {
      const result = await unlockItem(item.kind, item.id);
      setBusy(null);
      if (result.ok) {
        toast.success({ title: t("done", { path: item.path }) });
      } else {
        const code = KNOWN_ERRORS.includes(result.error) ? result.error : "unexpected";
        toast.error({
          title: t(`errors.${code}.title` as "errors.unexpected.title"),
          message: t(`errors.${code}.detail` as "errors.unexpected.detail"),
        });
      }
      router.refresh();
      requestAnimationFrame(() => document.getElementById(LOCKED_LIST_ID)?.focus());
    });
  }

  const labels = { by: t("by"), at: t("at"), covers: t("covers") };
  return (
    <section className={styles.section} aria-labelledby={LOCKED_LIST_ID}>
      <h2 id={LOCKED_LIST_ID} tabIndex={-1} className={styles.sectionTitle}>
        {t("listTitle", { count: items.length })}
      </h2>
      {items.length === 0 ? (
        <p className={styles.muted}>{t("none")}</p>
      ) : (
        <ul className={styles.items}>
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className={styles.item}>
              <p className={styles.path}>
                <span className={styles.kind}>{t(`kinds.${item.kind}`)}</span> {item.path}
              </p>
              <ItemFacts
                kind={item.kind}
                by={item.lockedBy}
                at={item.lockedAt}
                reason={item.reason}
                coveredFolders={item.coveredFolders}
                coveredNotes={item.coveredNotes}
                timezone={timezone}
                labels={labels}
              />
              <div>
                <Button variant="secondary" pending={busy === item.id} onClick={() => unlock(item)}>
                  {busy === item.id ? t("working") : t("unlock")}
                  <span className="visually-hidden"> {item.path}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
