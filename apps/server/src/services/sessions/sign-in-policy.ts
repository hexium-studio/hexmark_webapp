import { env } from "../../config/env";
import { serverNotConfigured } from "../../config/secrets";
import { type Failure, fail } from "../../lib/outcome";

// Whether new sessions may be created at all. While SETUP_TOKEN is set,
// nobody can sign in: the token is meant to be removed once the first admin
// exists, and leaving it in place must not go unnoticed. SETUP_TOKEN is read
// once at start-up, so the answer changes only with a restart.
//
// createSession (sessions.ts) asks this for every session it creates, so the
// rule holds for every way of signing in; login.ts asks it first as well, only
// to answer before checking credentials.
//
// Likewise while a required instance key is missing or invalid
// (src/config/secrets.ts): the server is not fully configured.

export type SignInRefusal = "server_not_configured" | "setup_token_present";

export function signInRefusal(): SignInRefusal | null {
  if (serverNotConfigured()) return "server_not_configured";
  return env.setupToken.present ? "setup_token_present" : null;
}

// The answer to a refused sign-in, the same on every endpoint that would
// start a session: a configuration problem of the server (503), or the
// setup token still being set (403).
export function signInRefusalFailure(reason: SignInRefusal): Failure {
  return fail(reason === "server_not_configured" ? 503 : 403, reason);
}
