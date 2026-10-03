"use client";

import { fewRecoveryCodesLeft, hasAnyFactor } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button/Button";
import { SectionHead } from "./SectionHead";
import styles from "./Security.module.css";
import type { SectionProps } from "./section-props";
import type { SensitiveRequest } from "./sensitive";

const HEADING_ID = "security-codes";

// How many recovery codes are left, and new ones (confirmed with the
// password; the old ones stop working). Codes exist only together with a
// second factor, so without one there is nothing to generate. The count is
// shown on its own, not against the size of a fresh set: codes issued
// earlier may outnumber it.
export function CodesSection(props: SectionProps & { onRegenerate(r: SensitiveRequest): void }) {
  const t = useTranslations("accountSecurity.codes");
  const { remaining } = props.security.recoveryCodes;
  const hasFactor = hasAnyFactor(props.counts);
  const low = hasFactor && fewRecoveryCodesLeft(remaining);
  return (
    <section className={styles.section} aria-labelledby={HEADING_ID}>
      <SectionHead
        id={HEADING_ID}
        title={t("title")}
        status={hasFactor ? t("left", { count: remaining }) : t("noneShort")}
        on={hasFactor && remaining > 0}
      />
      <p className={styles.muted}>{hasFactor ? (low ? t("low") : t("description")) : t("none")}</p>
      {hasFactor ? (
        <div>
          <Button variant="secondary" onClick={() => props.onRegenerate({ kind: "regenerate" })}>
            {t("regenerate")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
