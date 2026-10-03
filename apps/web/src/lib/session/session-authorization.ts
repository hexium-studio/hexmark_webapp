import { SESSION_AUTH_SCHEME } from "@hexmark/shared";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "./cookie";

// `Authorization` header with the session token of the current request, for
// calls to the API server on behalf of the signed-in user. Undefined without
// a usable cookie. Server code only.
export async function sessionAuthorization(): Promise<string | undefined> {
  const token = readSessionToken((await cookies()).get(SESSION_COOKIE_NAME)?.value);
  return token ? `${SESSION_AUTH_SCHEME} ${token}` : undefined;
}
