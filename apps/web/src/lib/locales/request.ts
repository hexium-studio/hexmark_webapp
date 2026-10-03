import { getRequestConfig } from "next-intl/server";
import { loadMessages } from "./registry";
import { resolveLocale } from "./resolve-locale";

// next-intl request config (wired up in next.config.ts). No locale in the
// URL: the locale comes from the user, a cookie, the instance or the browser.
export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return { locale, messages: loadMessages(locale) };
});
