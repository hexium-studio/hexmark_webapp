// The cookie that stores the UI language outside a signed-in session. Set by
// the setup wizard's language step (and the language switch of the setup
// pages) and on sign-in to the account's locale, so the sign-in page shows
// that language after signing out. Read by resolve-locale.ts.

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
