import { type NextRequest, NextResponse } from "next/server";
import { requestOrigin } from "@/lib/client-origin/request-origin";
import { readSessionToken, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session/cookie";
import { fetchMe } from "@/lib/session/me";
import {
  encodeSessionHeader,
  type ResolvedSession,
  SESSION_HEADER,
  tokenDigest,
} from "@/lib/session/session-header";

// Request proxy (Next.js 16; formerly middleware). Runs before every page
// render and server action and keeps the session cookie fresh:
//   - no cookie: signed out, no API call;
//   - GET /api/auth/v1/me with the token, server to server;
//   - 200 with rotatedToken: the new token goes into the cookie (response)
//     and into the request, so the page and actions already use it;
//   - 401: the cookie is deleted (response and request);
//   - no usable answer: the cookie stays, the page shows the server problem.
// The outcome travels to the page as a request header (lib/session/
// session-header.ts); pages only read it (lib/session/current-session.ts)
// and never write cookies. The token never leaves the server side.

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const token = readSessionToken(raw);
  let session: ResolvedSession = { state: "signed-out" };
  // The token in the cookie once this request is done.
  let current = token;
  let write: { token: string; remember: boolean; expiresAt: string } | "delete" | undefined;
  // next/headers is not available here, so the address is passed on.
  const origin = requestOrigin(request.headers);

  if (token) {
    const me = await fetchMe(token, origin.ip ?? null);
    if (me.kind === "valid") {
      session = { state: "signed-in", user: me.user };
      if (me.rotatedToken) {
        current = me.rotatedToken;
        write = { token: me.rotatedToken, remember: me.remember, expiresAt: me.expiresAt };
      }
    } else if (me.kind === "invalid") {
      current = undefined;
      write = "delete";
    } else {
      session = { state: "unavailable" };
    }
  } else if (raw !== undefined) {
    // Empty or malformed: no session can match it.
    write = "delete";
  }

  if (write === "delete") request.cookies.delete(SESSION_COOKIE_NAME);
  else if (write) request.cookies.set(SESSION_COOKIE_NAME, write.token);

  const headers = new Headers(request.headers);
  // Replaces whatever the browser may have sent under this name.
  headers.set(
    SESSION_HEADER,
    encodeSessionHeader({ token: current ? await tokenDigest(current) : "", session }),
  );
  const response = NextResponse.next({ request: { headers } });

  if (write === "delete") {
    // With the path it was set with; otherwise the deletion would apply to
    // the path of this request only.
    response.cookies.delete({ name: SESSION_COOKIE_NAME, path: "/" });
  } else if (write) {
    response.cookies.set(
      SESSION_COOKIE_NAME,
      write.token,
      sessionCookieOptions({ ...write, secure: origin.secure, now: new Date() }),
    );
  }
  return response;
}

// Everything that can render a page or run a server action. Left out: build
// assets and files with an extension, which never read the session.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.[A-Za-z0-9]+$).*)"],
};
