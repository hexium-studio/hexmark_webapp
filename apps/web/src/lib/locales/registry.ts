import { isLocale, parentLocale } from "@hexmark/shared";
import { buildCatalogue, type Catalogue, FALLBACK_LOCALE } from "./catalogue";
import { builtInDir, customDir, readCatalogueFiles } from "./catalogue-files";
import type { LocaleInfo } from "./locale-info";
import type { Messages } from "./messages";

// The one place that knows which UI languages exist, what they are called and
// where their messages come from. Everything else (request config, language
// pickers, Accept-Language matching) asks this module and never lists locales
// itself.
// The languages are found at run time: the built-in catalogues in
// apps/web/messages/ and custom ones from a mounted folder (see
// catalogue-files.ts and docs/translations.md). They are read once per server
// process, at start (instrumentation.ts) or on first use.
// Server code only (it reads files); client components receive LocaleInfo as
// props and their messages through NextIntlClientProvider.

// The English catalogue defines the keys (see messages.ts and next-intl.d.ts).
export type { LocaleInfo, Messages };
export { FALLBACK_LOCALE };

// Kept on globalThis: Next.js bundles instrumentation and routes separately,
// and module state would be loaded (and logged) once per bundle.
const CATALOGUE = Symbol.for("hexmark.locales.catalogue");
type CatalogueStore = typeof globalThis & { [CATALOGUE]?: Catalogue };

function catalogue(): Catalogue {
  const store = globalThis as CatalogueStore;
  store[CATALOGUE] ??= buildCatalogue(
    readCatalogueFiles(builtInDir(), "built-in"),
    readCatalogueFiles(customDir(), "custom"),
  );
  return store[CATALOGUE];
}

export function availableLocales(): readonly LocaleInfo[] {
  return catalogue().locales;
}

// The locale with exactly this code, if available. Anything that is not a
// well-formed code (cookies, headers, API answers) finds nothing.
export function findLocale(code: unknown): LocaleInfo | undefined {
  if (!isLocale(code)) return undefined;
  return catalogue().locales.find((locale) => locale.code === code);
}

// For a stored choice (user, cookie, instance default): the locale itself,
// else its language, so "de-CH" still gets German after its overlay file
// was removed.
export function closestLocale(code: unknown): LocaleInfo | undefined {
  if (!isLocale(code)) return undefined;
  return findLocale(code) ?? findLocale(parentLocale(code));
}

// Complete messages of an available locale: its own over its language's over
// the English ones. An unknown code gets the English messages.
export function loadMessages(code: string): Messages {
  const { messages } = catalogue();
  const found = isLocale(code) ? messages.get(code) : undefined;
  return (found ?? messages.get(FALLBACK_LOCALE)) as Messages;
}
