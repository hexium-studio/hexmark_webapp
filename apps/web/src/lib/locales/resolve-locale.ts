import { cookies, headers } from "next/headers";
import { cache } from "react";
import { matchAcceptLanguage } from "./accept-language";
import { fetchInstanceDefaultLocale } from "./instance-locale";
import { LOCALE_COOKIE } from "./locale-cookie";
import { availableLocales, closestLocale, FALLBACK_LOCALE } from "./registry";

// The UI language of the current request, first match wins:
//   1. the signed-in user's saved locale (users.locale)
//   2. the cookie set by a visible language picker
//   3. the instance default locale (instance_settings, exists after setup)
//   4. the browser's Accept-Language header
//   5. English
// Each source counts only with a locale the registry offers; a stored
// regional code whose file is gone falls back to its language (de-CH -> de).
// Later sources are not asked once one has answered (step 3 is an HTTP call).

// Hook for step 1: once sign-in exists, return the signed-in user's locale
// here (e.g. from the session). Until then nobody is signed in.
async function savedUserLocale(): Promise<string | undefined> {
  return undefined;
}

function available(code: string | undefined): string | undefined {
  return closestLocale(code)?.code;
}

export const resolveLocale = cache(async (): Promise<string> => {
  const fromUser = available(await savedUserLocale());
  if (fromUser) return fromUser;
  const fromCookie = available((await cookies()).get(LOCALE_COOKIE)?.value);
  if (fromCookie) return fromCookie;
  const fromInstance = available(await fetchInstanceDefaultLocale());
  if (fromInstance) return fromInstance;
  const codes = availableLocales().map((locale) => locale.code);
  const fromBrowser = matchAcceptLanguage((await headers()).get("accept-language"), codes);
  return fromBrowser ?? FALLBACK_LOCALE;
});
