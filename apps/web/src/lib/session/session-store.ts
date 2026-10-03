import { cookies, headers } from "next/headers";
import { requestOrigin } from "@/lib/client-origin/request-origin";
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from "@/lib/locales/locale-cookie";
import { closestLocale } from "@/lib/locales/registry";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "./cookie";
import { PENDING_SESSION_COOKIE, pendingSessionOptions, readPendingSession } from "./pending";
import type { SignedIn } from "./signed-in";

// Starting the browser's session once the API server issued one (sign-in,
// second factor, forced enrolment). Server actions only. Writing a cookie
// makes Next.js render the current page again in the same request, which
// then shows home.

export async function storeSession({ session, locale }: SignedIn): Promise<void> {
  const { secure } = requestOrigin(await headers());
  const jar = await cookies();
  jar.set(
    SESSION_COOKIE_NAME,
    session.token,
    sessionCookieOptions({ ...session, secure, now: new Date() }),
  );
  // The account's language also becomes the language of this device before
  // sign-in (lib/locales/locale-order.ts): after signing out, the sign-in
  // page speaks it instead of falling back to the browser's language.
  const known = closestLocale(locale);
  if (known) jar.set(LOCALE_COOKIE, known.code, LOCALE_COOKIE_OPTIONS);
}

// Forced enrolment ends with a session and the account's first recovery
// codes, which must be shown before home replaces the sign-in page. The
// session waits in its own httpOnly cookie (pending.ts) until the user has
// saved the codes and continues.
export async function holdSession(signedIn: SignedIn): Promise<void> {
  const { secure } = requestOrigin(await headers());
  const { name, value, options } = pendingSessionOptions(signedIn, secure, new Date());
  (await cookies()).set(name, value, options);
}

// Moves the held session into the session cookie. False when there is none
// (expired or never held).
export async function releaseHeldSession(): Promise<boolean> {
  const jar = await cookies();
  const held = readPendingSession(jar.get(PENDING_SESSION_COOKIE)?.value);
  jar.delete({ name: PENDING_SESSION_COOKIE, path: "/" });
  if (!held) return false;
  await storeSession(held);
  return true;
}
