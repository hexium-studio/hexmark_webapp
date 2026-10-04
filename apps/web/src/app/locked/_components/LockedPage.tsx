"use client";

import { useTranslations } from "next-intl";
import { CardShell } from "@/components/card-shell/CardShell";
import { FormAlert } from "@/components/form-alert/FormAlert";
import type { LockedPageData } from "@/lib/locks/load";
import { HiddenSection } from "./HiddenSection";
import styles from "./Locked.module.css";
import { LockedSection } from "./LockedSection";

const TITLE_ID = "locked-title";

// /locked: what agents cannot change (locked) or not even read (hidden),
// each list with the way to lift the mark - Unlock at once, Unhide after a
// confirmation with the password (HiddenSection.tsx).
export function LockedPage({ data }: { data: LockedPageData | undefined }) {
  const t = useTranslations("locked");
  const home = (
    <a href="/" className={styles.link}>
      {t("home")}
    </a>
  );

  if (!data) {
    return (
      <CardShell width="wide" title={t("title")}>
        <FormAlert title={t("unavailable.title")}>
          <p>{t("unavailable.detail")}</p>
        </FormAlert>
        {home}
      </CardShell>
    );
  }

  return (
    <CardShell width="wide" title={t("title")} titleId={TITLE_ID} lead={t("lead")}>
      <LockedSection items={data.items} timezone={data.timezone} />
      <HiddenSection
        items={data.hidden}
        timezone={data.timezone}
        reauthenticatedUntil={data.reauthenticatedUntil}
      />
      {home}
    </CardShell>
  );
}
