"use client";

import type { LocaleBlock, LocaleBlockId, LocaleInfo } from "@/lib/locales/locale-info";
import styles from "./LanguageSelect.module.css";

export interface LanguageSelectProps {
  // Ties the select to its visible <label htmlFor>.
  id: string;
  // In display order (lib/locales/picker-locales.ts).
  locales: readonly LocaleInfo[];
  value: string;
  onChange(code: string): void;
  className?: string;
  // The same locales in blocks; with more than one block, each becomes an
  // <optgroup> with its (translated) label.
  blocks?: readonly LocaleBlock[];
  blockLabels?: Record<LocaleBlockId, string>;
}

function Option({ locale }: { locale: LocaleInfo }) {
  return (
    <option value={locale.code} lang={locale.code} dir={locale.dir}>
      {locale.name}
    </option>
  );
}

// Native select for long language lists (see prefersCompactPicker): keyboard,
// screen readers and mobile pickers work without extra code. Choosing an
// option only changes the value; the caller applies it with a button, so a
// language never switches while someone is still moving through the list.
// Each option is named in its own language and carries its `lang` and `dir`;
// the select takes those of the chosen option, which is the text it shows.
export function LanguageSelect(props: LanguageSelectProps) {
  const { id, locales, value, onChange, className, blocks, blockLabels } = props;
  const chosen = locales.find((locale) => locale.code === value);
  const classes = [styles.select, className].filter(Boolean).join(" ");
  const grouped = blocks && blockLabels && blocks.length > 1;
  return (
    <select
      id={id}
      className={classes}
      value={value}
      lang={chosen?.code}
      dir={chosen?.dir}
      onChange={(event) => onChange(event.target.value)}
    >
      {grouped
        ? blocks.map((block) => (
            <optgroup key={block.id} label={blockLabels[block.id]}>
              {block.locales.map((locale) => (
                <Option key={locale.code} locale={locale} />
              ))}
            </optgroup>
          ))
        : locales.map((locale) => <Option key={locale.code} locale={locale} />)}
    </select>
  );
}
