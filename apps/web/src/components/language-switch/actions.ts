"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from "@/lib/locales/locale-cookie";
import { findLocale } from "@/lib/locales/registry";

// Server action behind every visible language picker: stores the choice in
// the locale cookie. Setting a cookie in an action makes Next.js re-render
// the current page, which then appears in the new language; client state
// (wizard step, entered data) is kept. Returns false for a locale the
// registry does not offer.
export async function setLocale(code: string): Promise<boolean> {
  const locale = findLocale(code);
  if (!locale) return false;
  (await cookies()).set(LOCALE_COOKIE, locale.code, LOCALE_COOKIE_OPTIONS);
  return true;
}
