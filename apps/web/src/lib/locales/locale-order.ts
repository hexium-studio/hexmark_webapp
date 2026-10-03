// The order in which the UI language of a request is chosen, first match
// wins:
//   1. the signed-in user's saved locale (users.locale)
//   2. the locale cookie (set by the setup language step, and on sign-in to
//      the account's locale, so the sign-in page later speaks it too)
//   3. the browser's Accept-Language header
//   4. the instance default locale (instance_settings, exists after setup)
//   5. English
// Pure and free of request APIs, so the order is unit-tested; the sources
// come from resolve-locale.ts. The instance default is asked last and only
// when needed, because it is an HTTP call to the API server.

export interface LocaleSources {
  // Each returns an available locale code, or undefined to pass.
  user: () => Promise<string | undefined>;
  cookie: () => Promise<string | undefined>;
  browser: () => Promise<string | undefined>;
  instance: () => Promise<string | undefined>;
}

export const LOCALE_SOURCE_ORDER = ["user", "cookie", "browser", "instance"] as const;

export async function pickLocale(sources: LocaleSources, fallback: string): Promise<string> {
  for (const name of LOCALE_SOURCE_ORDER) {
    const code = await sources[name]();
    if (code) return code;
  }
  return fallback;
}
