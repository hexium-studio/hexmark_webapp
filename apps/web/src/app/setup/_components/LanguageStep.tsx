"use client";

import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { LanguageSelect } from "@/components/language-select/LanguageSelect";
import { setLocale } from "@/components/language-switch/actions";
import { prefersCompactPicker } from "@/lib/locales/locale-info";
import { LanguageOptions } from "./LanguageOptions";
import styles from "./LanguageStep.module.css";
import stepStyles from "./Step.module.css";
import type { StepProps } from "./wizard-types";

// First step: the language of the wizard, later also the language of the
// admin account and the instance default (sent with create-first-admin).
// Preselected is the language the page is shown in. The languages come in
// blocks: the browser's, those added on this server, then the others
// (lib/locales/picker-locales.ts).
// Picking a radio switches the page language at once (locale cookie, the
// page re-renders) and stays on this step. A longer list is one select
// (prefersCompactPicker); there "Apply" switches, because a select must not
// change the page while someone moves through it (WCAG 3.2.2).
// "Continue" stores the choice once more, so the preselected language is
// remembered across reloads too, and moves on.
export function LanguageStep({ wizard }: StepProps) {
  const t = useTranslations();
  const active = useLocale();
  const [choice, setChoice] = useState(active);
  const [switchedTo, setSwitchedTo] = useState<string>();
  const [isSwitching, startSwitch] = useTransition();
  const [isSaving, startSave] = useTransition();
  const selectId = useId();
  const pickerRef = useRef<HTMLDivElement>(null);
  const { locales, localeBlocks } = wizard;
  const compact = prefersCompactPicker(locales);

  // The re-render keeps the controls, so focus normally stays put. If the
  // new order moved the focused control, it lost focus: give it back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on purpose when the language changed
  useEffect(() => {
    if (!switchedTo || document.activeElement !== document.body) return;
    pickerRef.current?.querySelector<HTMLElement>("input:checked, select")?.focus();
  }, [active]);

  function switchTo(code: string) {
    setChoice(code);
    setSwitchedTo(code);
    startSwitch(async () => {
      await setLocale(code);
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    startSave(async () => {
      if (await setLocale(choice)) wizard.next();
    });
  }

  const switched = locales.find((locale) => locale.code === switchedTo);
  return (
    <form className={stepStyles.form} onSubmit={handleSubmit}>
      {compact ? (
        <div ref={pickerRef} className={styles.selectField}>
          <label htmlFor={selectId} className={styles.legend}>
            {t("setup.language.legend")}
          </label>
          <div className={styles.selectRow}>
            <LanguageSelect
              id={selectId}
              locales={locales}
              value={choice}
              onChange={setChoice}
              className={styles.select}
              blocks={localeBlocks}
              blockLabels={{
                browser: t("setup.language.browserLanguage"),
                added: t("setup.language.addedOnServer"),
                other: t("setup.language.otherLanguages"),
              }}
            />
            <Button
              variant="secondary"
              pending={isSwitching}
              onClick={() => (choice === active ? undefined : switchTo(choice))}
            >
              {t("languageSwitch.apply")}
            </Button>
          </div>
        </div>
      ) : (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{t("setup.language.legend")}</legend>
          <LanguageOptions
            ref={pickerRef}
            blocks={localeBlocks}
            choice={choice}
            onChoose={switchTo}
          />
        </fieldset>
      )}
      {/* Says, in the new language, that the switch is done. Text only once
          the page is in that language, so it is announced once. */}
      <p className="visually-hidden" role="status">
        {switched && switched.code === active
          ? t("setup.language.changed", { name: switched.name })
          : null}
      </p>
      <div className={stepStyles.actions}>
        <Button type="submit" pending={isSaving}>
          {isSaving ? t("setup.language.saving") : t("common.continue")}
        </Button>
      </div>
    </form>
  );
}
