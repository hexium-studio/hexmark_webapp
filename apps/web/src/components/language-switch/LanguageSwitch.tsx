"use client";

import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { LanguageSelect } from "@/components/language-select/LanguageSelect";
import { type LocaleInfo, prefersCompactPicker } from "@/lib/locales/locale-info";
import { setLocale } from "./actions";
import styles from "./LanguageSwitch.module.css";

export interface LanguageSwitchProps {
  // From the locale registry (lib/locales/registry.ts), passed by the page.
  locales: readonly LocaleInfo[];
}

// Language picker for the side panel. Choosing another language stores it in
// the locale cookie; the page then re-renders in that language and keeps its
// state (see actions.ts). Controls stay in place, so focus stays where it was.
// A few languages: one toggle button each. More (prefersCompactPicker): a
// select plus an "Apply" button.
export function LanguageSwitch({ locales }: LanguageSwitchProps) {
  const active = useLocale();
  const [isPending, startTransition] = useTransition();

  function choose(code: string) {
    if (isPending || code === active) return;
    startTransition(async () => {
      await setLocale(code);
    });
  }

  const Picker = prefersCompactPicker(locales) ? SelectPicker : ButtonPicker;
  return <Picker locales={locales} active={active} isPending={isPending} choose={choose} />;
}

interface PickerProps {
  locales: readonly LocaleInfo[];
  active: string;
  isPending: boolean;
  choose(code: string): void;
}

// Each language named in its own language (with its `lang`). The active one
// is pressed, bold and underlined, so the state does not rest on colour.
function ButtonPicker({ locales, active, isPending, choose }: PickerProps) {
  const t = useTranslations("languageSwitch");
  return (
    <fieldset className={styles.root} aria-busy={isPending}>
      <legend className={styles.label}>{t("label")}</legend>
      <span className={styles.options}>
        {locales.map((locale) => (
          <button
            key={locale.code}
            type="button"
            lang={locale.code}
            dir={locale.dir}
            className={styles.option}
            aria-pressed={locale.code === active}
            data-pending={isPending || undefined}
            onClick={() => choose(locale.code)}
          >
            {locale.name}
          </button>
        ))}
      </span>
    </fieldset>
  );
}

// Changing the select alone switches nothing (no change of context on
// input, WCAG 3.2.2); "Apply" does.
function SelectPicker({ locales, active, isPending, choose }: PickerProps) {
  const t = useTranslations("languageSwitch");
  const id = useId();
  const [choice, setChoice] = useState(active);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    choose(choice);
  }

  return (
    <form className={styles.compact} aria-busy={isPending} onSubmit={handleSubmit}>
      <label htmlFor={id} className={styles.label}>
        {t("label")}
      </label>
      <span className={styles.compactRow}>
        <LanguageSelect
          id={id}
          locales={locales}
          value={choice}
          onChange={setChoice}
          className={styles.select}
        />
        <button type="submit" className={styles.apply} data-pending={isPending || undefined}>
          {t("apply")}
        </button>
      </span>
    </form>
  );
}
