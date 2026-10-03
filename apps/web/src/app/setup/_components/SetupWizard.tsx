"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { LanguageSwitch } from "@/components/language-switch/LanguageSwitch";
import { PageHeading } from "@/components/page-heading/PageHeading";
import { PageShell } from "@/components/page-shell/PageShell";
import { StepList } from "@/components/step-list/StepList";
import type { LocaleBlock, LocaleInfo } from "@/lib/locales/locale-info";
import { RICH_TAGS } from "@/lib/rich-tags";
import type { SetupStatusResult } from "@/lib/setup-status";
import { setupProgress } from "@/lib/setup-steps";
import styles from "./SetupWizard.module.css";
import { SETUP_STEPS } from "./steps";
import type { WizardControls, WizardData } from "./wizard-types";

export interface SetupWizardProps {
  status: SetupStatusResult;
  // In display order, flat and in blocks (lib/locales/picker-locales.ts).
  locales: readonly LocaleInfo[];
  localeBlocks: readonly LocaleBlock[];
}

const HEADING_ID = "setup-step-heading";

// Holds the current step and the data collected so far. Data lives in
// client state only (the verified token is not stored anywhere else), so it
// survives a language change, which re-renders the page with new props.
export function SetupWizard({ status, locales, localeBlocks }: SetupWizardProps) {
  const t = useTranslations("setup");
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<WizardData>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasMoved = useRef(false);

  // Move focus to the new step's heading, but not on the first render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on purpose whenever the step changes
  useEffect(() => {
    if (!hasMoved.current) return;
    headingRef.current?.focus();
  }, [index]);

  function moveTo(nextIndex: number) {
    const bounded = Math.min(Math.max(nextIndex, 0), SETUP_STEPS.length - 1);
    hasMoved.current = true;
    // The status shown in the connection check may be outdated when coming back to it.
    if (SETUP_STEPS[bounded]?.id === "connection" && bounded !== index) router.refresh();
    setIndex(bounded);
  }

  const wizard: WizardControls = {
    status,
    locales,
    localeBlocks,
    data,
    update: (patch) => setData((current) => ({ ...current, ...patch })),
    next: () => moveTo(index + 1),
    back: () => moveTo(index - 1),
    goTo: (stepId) => {
      const target = SETUP_STEPS.findIndex((step) => step.id === stepId);
      if (target >= 0) moveTo(target);
    },
  };

  const step = SETUP_STEPS[index] ?? SETUP_STEPS[0];
  if (!step) return null;
  const { Component } = step;

  return (
    <PageShell
      title={t("title")}
      lead={t("lead")}
      progress={
        <StepList
          items={setupProgress(index, (id) => t(`steps.${id}.title`))}
          label={t("progressLabel")}
        />
      }
      // The language step is the picker itself.
      tools={step.id === "language" ? null : <LanguageSwitch locales={locales} />}
    >
      <section className={styles.section} aria-labelledby={HEADING_ID}>
        <PageHeading
          id={HEADING_ID}
          headingRef={headingRef}
          kicker={t("stepCounter", { current: index + 1, total: SETUP_STEPS.length })}
          title={t(`steps.${step.id}.title`)}
          intro={t.rich(`steps.${step.id}.intro`, RICH_TAGS)}
        />
        <Component key={step.id} wizard={wizard} />
      </section>
    </PageShell>
  );
}
