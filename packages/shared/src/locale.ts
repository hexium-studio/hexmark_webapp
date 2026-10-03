import { z } from "zod";
import { requiredOr } from "./field-errors";
import { LOCALE_PATTERN } from "./locale-pattern";

// UI languages are open-ended: besides the built-in catalogues, translations
// can be supplied as files at run time, so no list of locales lives here (the
// web app's locale registry knows which ones are available). What is fixed is
// the form of a code, see locale-pattern.ts.
export { LOCALE_PATTERN };

// A string that passed localeSchema (or isLocale). Plain strings must go
// through one of them before they can be used where a Locale is expected.
export type Locale = string & z.core.$brand<"Locale">;

// Fallback when neither the user, a cookie nor the browser names an available locale.
export const DEFAULT_LOCALE = "en" as Locale;

// Format only: a well-formed code is accepted even if no catalogue exists for
// it (the web app falls back to English). The error code stays
// "invalid_option": in the UI a locale comes from a picker, so a rejected
// value means one that was not offered.
export const localeSchema = z
  .string({ error: requiredOr("invalid_option") })
  .regex(LOCALE_PATTERN, { error: "invalid_option" })
  .brand<"Locale">();

export function isLocale(value: unknown): value is Locale {
  return localeSchema.safeParse(value).success;
}

// The language a regional code falls back to ("de-CH" -> "de"); undefined
// for a code without region. The language part of a well-formed code is a
// well-formed code itself.
export function parentLocale(code: Locale): Locale | undefined {
  const [language, region] = code.split("-");
  return region && language ? (language as Locale) : undefined;
}
