"use client";

import type { HiddenItem } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/button/Button";
import { ItemFacts } from "./ItemFacts";
import styles from "./Locked.module.css";
import { UnhideDialog } from "./UnhideDialog";

export const HIDDEN_LIST_ID = "hidden-list";

export interface HiddenSectionProps {
  items: HiddenItem[];
  timezone: string;
  reauthenticatedUntil: string | null;
}

// The notes and folders hidden themselves, by path: who hid it, when, why,
// and for a folder how much below it is hidden with it. "Unhide" asks for a
// confirmation naming the item - and the password unless it was entered in
// the last 10 minutes - because unhiding lets every agent read it again
// (UnhideDialog.tsx).
export function HiddenSection(props: HiddenSectionProps) {
  const t = useTranslations("locked.hidden");
  const tl = useTranslations("locked");
  const [confirming, setConfirming] = useState<HiddenItem | null>(null);
  const [until, setUntil] = useState(props.reauthenticatedUntil);
  const { items } = props;
  const labels = { by: t("by"), at: t("at"), covers: t("covers") };
  return (
    <section className={styles.section} aria-labelledby={HIDDEN_LIST_ID}>
      <h2 id={HIDDEN_LIST_ID} tabIndex={-1} className={styles.sectionTitle}>
        {t("listTitle", { count: items.length })}
      </h2>
      {items.length === 0 ? (
        <p className={styles.muted}>{t("none")}</p>
      ) : (
        <ul className={styles.items}>
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className={styles.item}>
              <p className={styles.path}>
                <span className={styles.kind}>{tl(`kinds.${item.kind}`)}</span> {item.path}
              </p>
              <ItemFacts
                kind={item.kind}
                by={item.hiddenBy}
                at={item.hiddenAt}
                reason={item.reason}
                coveredFolders={item.coveredFolders}
                coveredNotes={item.coveredNotes}
                timezone={props.timezone}
                labels={labels}
              />
              <div>
                <Button variant="secondary" onClick={() => setConfirming(item)}>
                  {t("unhide")}
                  <span className="visually-hidden"> {item.path}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <UnhideDialog
        item={confirming}
        reauthenticatedUntil={until}
        onReauthenticated={setUntil}
        onClose={() => setConfirming(null)}
      />
    </section>
  );
}
