import { CHALLENGE_AUTH_SCHEME, type IssuedChallenge } from "@hexmark/shared";
import { cookies, headers } from "next/headers";
import { requestOrigin } from "@/lib/client-origin/request-origin";
import { CHALLENGE_COOKIE_NAME, challengeCookieOptions, readChallengeToken } from "./cookie";

// Reading and writing the challenge cookie (cookie.ts) from server actions
// and server components. Server code only; the token never reaches the
// browser in a response body.

export async function storeChallenge(challenge: IssuedChallenge): Promise<void> {
  const { secure } = requestOrigin(await headers());
  (await cookies()).set(
    CHALLENGE_COOKIE_NAME,
    challenge.token,
    challengeCookieOptions(challenge.expiresAt, secure, new Date()),
  );
}

export async function clearChallenge(): Promise<void> {
  (await cookies()).delete({ name: CHALLENGE_COOKIE_NAME, path: "/" });
}

// `Authorization` header for the API server, or undefined without a usable
// cookie (the API would refuse with challenge_invalid anyway).
export async function challengeAuthorization(): Promise<string | undefined> {
  const token = readChallengeToken((await cookies()).get(CHALLENGE_COOKIE_NAME)?.value);
  return token ? `${CHALLENGE_AUTH_SCHEME} ${token}` : undefined;
}
