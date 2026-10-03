import { cookies, headers } from "next/headers";
import { cache } from "react";
import { currentSession } from "@/lib/session/current-session";
import { matchAcceptLanguage } from "./accept-language";
import { fetchInstanceDefaultLocale } from "./instance-locale";
import { LOCALE_COOKIE } from "./locale-cookie";
import { pickLocale } from "./locale-order";
import { availableLocales, closestLocale, FALLBACK_LOCALE } from "./registry";

// The UI language of the current request; the order is in locale-order.ts.
// Each source counts only with a locale the registry offers; a stored
// regional code whose file is gone falls back to its language (de-CH -> de).

function available(code: string | undefined): string | undefined {
  return closestLocale(code)?.code;
}

export const resolveLocale = cache(
  async (): Promise<string> =>
    pickLocale(
      {
        // From the session the request proxy resolved (no extra API call).
        user: async () => {
          const session = await currentSession();
          return available(session.state === "signed-in" ? session.user.locale : undefined);
        },
        cookie: async () => available((await cookies()).get(LOCALE_COOKIE)?.value),
        browser: async () => {
          const codes = availableLocales().map((locale) => locale.code);
          return matchAcceptLanguage((await headers()).get("accept-language"), codes);
        },
        instance: async () => available(await fetchInstanceDefaultLocale()),
      },
      FALLBACK_LOCALE,
    ),
);
