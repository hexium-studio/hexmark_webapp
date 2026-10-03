import { matchAcceptLanguage } from "./accept-language";
import type { LocaleBlock, LocaleInfo } from "./locale-info";

// The order of a visible language picker (see picker-locales.ts), without
// request access, so it can be tested on its own:
//   1. the browser's language (best Accept-Language match, de-DE -> de)
//   2. languages added on this server (source "custom-new")
//   3. all others: built-in languages and their custom overrides
// Blocks 2 and 3 are sorted by their own names with the collation of
// `uiLocale`, the current UI language.

export interface PickerLocales {
  // Non-empty blocks only.
  blocks: readonly LocaleBlock[];
  // The same locales as one list, for pickers without blocks.
  locales: readonly LocaleInfo[];
}

export function arrangePickerLocales(
  all: readonly LocaleInfo[],
  acceptLanguage: string | null | undefined,
  uiLocale: string,
): PickerLocales {
  const codes = all.map((locale) => locale.code);
  const match = matchAcceptLanguage(acceptLanguage, codes);
  const browser = all.filter((locale) => locale.code === match);
  const collator = new Intl.Collator(uiLocale);
  const rest = all
    .filter((locale) => locale.code !== match)
    .sort((a, b) => collator.compare(a.name, b.name) || a.code.localeCompare(b.code));
  const blocks: LocaleBlock[] = [
    { id: "browser", locales: browser },
    { id: "added", locales: rest.filter((locale) => locale.source === "custom-new") },
    { id: "other", locales: rest.filter((locale) => locale.source !== "custom-new") },
  ];
  const filled = blocks.filter((block) => block.locales.length > 0);
  return { blocks: filled, locales: filled.flatMap((block) => block.locales) };
}
