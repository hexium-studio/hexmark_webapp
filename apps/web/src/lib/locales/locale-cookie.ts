// The cookie that stores the language picked in the UI before sign-in (the
// language step of the setup wizard, the language switch). Read by the
// request config (resolve-locale.ts), written by the setLocale action.

export const LOCALE_COOKIE = "hexmark_locale";

export const LOCALE_COOKIE_OPTIONS = {
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  // Only the Next.js server reads it.
  httpOnly: true,
  sameSite: "lax",
  // Not `secure`: instances often run on plain HTTP inside a home network,
  // and the cookie holds nothing but a language code.
} as const;
