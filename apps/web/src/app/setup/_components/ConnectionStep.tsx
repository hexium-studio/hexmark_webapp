"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { CheckStatus } from "@/components/check-status/CheckStatus";
import { RICH_TAGS } from "@/lib/rich-tags";
import { connectionChecks } from "./connection-checks";
import styles from "./Step.module.css";
import type { StepProps } from "./wizard-types";

// What the live region announces; kept as a state, not as text, so a
// language change mid-way re-renders it in the new language.
type Announcement = "none" | "checking" | "finished";

// Shows whether web app, server, database and setup token are ready.
// "Check again" reloads the status through page.tsx (router.refresh()); it is
// offered only while a check fails, "Continue" only when all pass.
export function ConnectionStep({ wizard }: StepProps) {
  const t = useTranslations("setup.connection");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isChecking, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState<Announcement>("none");
  const checkRequested = useRef(false);
  const continueRef = useRef<HTMLButtonElement>(null);

  const checks = connectionChecks(wizard.status);
  const failed = checks.filter((check) => check.state !== "pass").length;
  const allPassed = failed === 0;
  const summary = allPassed
    ? t("summaryPassed")
    : t("summaryFailed", { failed, total: checks.length });

  // Announce the result once the refreshed status has arrived.
  useEffect(() => {
    if (isChecking || !checkRequested.current) return;
    checkRequested.current = false;
    setAnnouncement("finished");
    // "Check again" had focus and is gone now; hand focus to its successor.
    if (allPassed) continueRef.current?.focus();
  }, [isChecking, allPassed]);

  function checkAgain() {
    if (isChecking) return;
    checkRequested.current = true;
    setAnnouncement("checking");
    startTransition(() => router.refresh());
  }

  const status =
    announcement === "checking"
      ? t("announceChecking")
      : announcement === "finished"
        ? t("announceFinished", { summary })
        : summary;

  return (
    <div className={styles.step}>
      <ul className={styles.checks} aria-busy={isChecking}>
        {checks.map((check) => (
          <li key={check.id}>
            <CheckStatus
              label={t(`labels.${check.id}`)}
              state={check.state}
              detail={t.rich(`detail.${check.detail}`, { ...check.values, ...RICH_TAGS })}
            />
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={wizard.back}>
          {tCommon("back")}
        </Button>
        {allPassed ? (
          <Button ref={continueRef} onClick={wizard.next}>
            {tCommon("continue")}
          </Button>
        ) : (
          <Button variant="secondary" pending={isChecking} onClick={checkAgain}>
            {isChecking ? t("checking") : t("checkAgain")}
          </Button>
        )}
        {/* Live region: exists from the start so screen readers pick up changes.
            Shows the summary until a check announces its progress or result. */}
        <p className={styles.status} role="status">
          {status}
        </p>
      </div>
      {allPassed ? null : <p className={styles.note}>{t("fixNote")}</p>}
    </div>
  );
}
