import type { Locale } from "@hexmark/shared";

// What client components may know about a locale. Kept apart from the
// registry, which reads files and must stay on the server.

// Where a locale comes from (catalogue.ts):
//   built-in         a catalogue in apps/web/messages/ only
//   custom-new       a custom translation for a language Hexmark does not
//                    ship, or a region of such a language ("added on this server")
//   custom-override  a custom translation replacing or completing a built-in
//                    one: the same code (de) or a region of it (de-CH)
export type LocaleSource = "built-in" | "custom-new" | "custom-override";

export interface LocaleInfo {
  // BCP 47 tag, also the value of the locale cookie and of users.locale.
  code: Locale;
  // Name from the catalogue's "_meta.name", in the language itself, e.g. "Deutsch".
  name: string;
  dir: "ltr" | "rtl";
  source: LocaleSource;
}

// The blocks of a language picker, in this order, empty ones left out
// (lib/locales/picker-locales.ts): the browser's language, languages added
// on this server, then all others.
export type LocaleBlockId = "browser" | "added" | "other";

export interface LocaleBlock {
  id: LocaleBlockId;
  locales: readonly LocaleInfo[];
}

// Up to this many languages, pickers show every language as its own control
// (radio rows, toggle buttons); beyond it a select keeps them short.
const MAX_LISTED_LOCALES = 5;

export function prefersCompactPicker(locales: readonly LocaleInfo[]): boolean {
  return locales.length > MAX_LISTED_LOCALES;
}
