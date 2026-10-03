"use client";

import { useTranslations } from "next-intl";
import { Fragment, type Ref, useId } from "react";
import type { LocaleBlock, LocaleInfo } from "@/lib/locales/locale-info";
import styles from "./LanguageStep.module.css";

export interface LanguageOptionsProps {
  blocks: readonly LocaleBlock[];
  choice: string;
  onChoose(code: string): void;
  ref?: Ref<HTMLDivElement>;
}

// The languages of the language step as radio rows, in blocks (browser's
// language, added on this server, others) with a decorative line between
// blocks. All radios share one name, so they are one group and the arrow
// keys move through every option across the lines.
// A row's name is the language name (in its own language); hints such as
// "Browser language" are in the UI language and describe the radio.
export function LanguageOptions({ blocks, choice, onChoose, ref }: LanguageOptionsProps) {
  const t = useTranslations("setup.language");
  const idPrefix = useId();

  function hints(block: LocaleBlock, locale: LocaleInfo): string[] {
    const added = locale.source === "custom-new" ? [t("addedOnServer")] : [];
    return block.id === "browser" ? [t("browserLanguage"), ...added] : added;
  }

  return (
    <div ref={ref} className={styles.options}>
      {blocks.map((block, blockIndex) => (
        <Fragment key={block.id}>
          {blockIndex > 0 ? <div className={styles.separator} aria-hidden="true" /> : null}
          {block.locales.map((locale) => {
            const id = `${idPrefix}-${locale.code}`;
            const texts = hints(block, locale);
            return (
              <label key={locale.code} className={styles.option}>
                <input
                  type="radio"
                  name="locale"
                  value={locale.code}
                  className={styles.radio}
                  checked={choice === locale.code}
                  aria-labelledby={`${id}-name`}
                  aria-describedby={texts.length > 0 ? `${id}-hints` : undefined}
                  onChange={() => onChoose(locale.code)}
                />
                <span id={`${id}-name`} lang={locale.code} dir={locale.dir} className={styles.name}>
                  {locale.name}
                </span>
                {texts.length > 0 ? (
                  <span id={`${id}-hints`} className={styles.hint}>
                    {texts.join(" · ")}
                  </span>
                ) : null}
              </label>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
