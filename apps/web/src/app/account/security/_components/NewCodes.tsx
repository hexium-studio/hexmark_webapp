"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { RecoveryCodes } from "@/components/two-factor/RecoveryCodes";
import styles from "./Security.module.css";

const HEADING_ID = "security-new-codes";

export interface NewCodesProps {
  codes: string[];
  // Created with the account's first factor (else: generated anew).
  first: boolean;
  account: string;
  timeZone: string;
  onDone(): void;
}

// New recovery codes in place of the page content, shown this one time;
// the heading takes focus so screen readers start here.
export function NewCodes({ codes, first, account, timeZone, onDone }: NewCodesProps) {
  const t = useTranslations("accountSecurity.codes");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section className={styles.section} aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID} ref={heading} tabIndex={-1} className={styles.sectionTitle}>
        {first ? t("firstHeading") : t("newHeading")}
      </h2>
      <RecoveryCodes
        codes={codes}
        labelledBy={HEADING_ID}
        account={account}
        timeZone={timeZone}
        doneLabel={t("done")}
        onDone={onDone}
      />
    </section>
  );
}
