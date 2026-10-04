"use client";

import { useFormatter, useTranslations } from "next-intl";
import styles from "./Locked.module.css";

export interface ItemFactsProps {
  kind: "note" | "folder";
  // Who set the mark, when (ISO 8601), why.
  by: string;
  at: string;
  reason: string | null;
  // Folders: what lies below and is covered too.
  coveredFolders: number;
  coveredNotes: number;
  timezone: string;
  labels: { by: string; at: string; covers: string };
}

// The facts of one locked or hidden item, as term and value pairs.
export function ItemFacts(props: ItemFactsProps) {
  const t = useTranslations("locked");
  const format = useFormatter();
  const when = format.dateTime(new Date(props.at), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: props.timezone,
  });
  return (
    <dl className={styles.facts}>
      <div>
        <dt>{props.labels.by}</dt>
        <dd>{props.by}</dd>
      </div>
      <div>
        <dt>{props.labels.at}</dt>
        <dd>{when}</dd>
      </div>
      <div>
        <dt>{t("reason")}</dt>
        <dd>{props.reason ?? t("noReason")}</dd>
      </div>
      {props.kind === "folder" ? (
        <div>
          <dt>{props.labels.covers}</dt>
          <dd>{t("covered", { folders: props.coveredFolders, notes: props.coveredNotes })}</dd>
        </div>
      ) : null}
    </dl>
  );
}
