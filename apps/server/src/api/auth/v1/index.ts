import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AUTH_BODY_LIMIT_BYTES } from "../../../config/security";
import { postEnrolmentTotpConfirm } from "./enrolment/totp/confirm";
import { postEnrolmentTotpStart } from "./enrolment/totp/start";
import { postEnrolmentWebauthnOptions } from "./enrolment/webauthn/registration/options";
import { postEnrolmentWebauthnVerify } from "./enrolment/webauthn/registration/verify";
import { postLogin } from "./login";
import { postLogout } from "./logout";
import { getMe } from "./me";
import { postReauthenticate } from "./reauthenticate";
import { postSecondFactorRecoveryCode } from "./second-factor/recovery-code";
import { postSecondFactorTotp } from "./second-factor/totp";
import { postSecondFactorWebauthnOptions } from "./second-factor/webauthn/options";
import { postSecondFactorWebauthnVerify } from "./second-factor/webauthn/verify";

// Sign-in of human users, version 1. Mounted at /api/auth/v1 (src/api/index.ts).
// Types of the bodies: packages/shared/src/{auth,two-factor}.ts.
//
// Called by the web server only (server to server). The browser holds the
// session token in the httpOnly cookie `hexmark_session`; the web server reads
// it and passes it on as `Authorization: Session <token>`. A sign-in that is
// not finished yet holds a challenge token instead (cookie
// `hexmark_challenge`, passed as `Authorization: Challenge <token>`). Both
// tokens are 43 characters base64url and never reach the browser in a body.
//
// POST /login   body { email, password, remember: boolean }
//   200, one of (check `status`):
//     { ok: true, status: "signed_in", user: { id, displayName, username,
//       role, locale }, session: { token, expiresAt, remember } }
//       `token` goes into the session cookie. Cookie: no Max-Age when
//       remember is false (ends with the browser session); otherwise
//       Max-Age = until expiresAt.
//     { ok: false, status: "second_factor_required",
//       challenge: { token, expiresAt }, methods: ("totp"|"webauthn"|"recovery")[] }
//       The account has a second factor. Keep the challenge token in the
//       challenge cookie until expiresAt (5 min) and continue with
//       /second-factor/*. `methods`: what this account can use now
//       ("webauthn" only while the server offers security keys, "recovery"
//       only while unused recovery codes exist).
//     { ok: false, status: "enrolment_required",
//       challenge: { token, expiresAt }, methods: ("totp"|"webauthn")[] }
//       The instance requires a second factor and the account has none. Keep
//       the token (15 min) and continue with /enrolment/*.
//     "remember" is carried by the challenge to the session it ends in.
//   400 { error: "validation", fields: { <field>: { code, params? } } }
//       email: required | invalid_type | too_long | invalid_email
//       password: required | invalid_type; remember: required | invalid_type
//       body: invalid_body (not a JSON object)
//   503 { error: "server_not_configured" }  a required key in .env is
//       missing or invalid (src/config/secrets.ts)
//   403 { error: "setup_token_present" }  while SETUP_TOKEN is set
//   429 { error: "rate_limited" }         too many failed sign-ins
//   401 { error: "invalid_credentials" }  unknown e-mail or wrong password
//   Checked in this order (after 503 and 413 below).
//
// POST /second-factor/totp           body { code: "123456" } (spaces ignored)
// POST /second-factor/recovery-code  body { code: "ABCD-EFGH-JKLM" }
//       (case, spaces and hyphens ignored)
// POST /second-factor/webauthn/verify  body { response: <the browser's
//       PublicKeyCredential as JSON, e.g. from @simplewebauthn/browser> }
//   header Authorization: Challenge <token of a second_factor challenge>
//   200 { ok: true, status: "signed_in", user, session }  as for /login;
//       the challenge is used up, delete the challenge cookie.
//   400 validation: code: required | invalid_type | invalid_format
//       (params { length }); response: required | invalid
//   401 { error: "invalid_code" | "webauthn_failed", attemptsRemaining }
//       wrong answer; at 0 the challenge is burnt (sign in again). A TOTP
//       code that was already used, or is outside ±1 time step, is wrong.
//   401 { error: "challenge_invalid" }  no, unknown, expired, used or burnt
//       challenge: back to the sign-in form, delete the challenge cookie.
//   409 { error: "method_unavailable" }  the account has no authenticator app
//       (totp) or no security key (webauthn options)
//   404 { error: "webauthn_unavailable" }  security keys are not offered
//   429 { error: "rate_limited" }  too many wrong answers from this address
//       (10 per 15 min) or overall (50); counted on top of the challenge's 5
//   403 setup_token_present / 503 server_not_configured as for /login
//
// POST /second-factor/webauthn/options  header Authorization: Challenge, no body
//   200 { options }  PublicKeyCredentialRequestOptionsJSON for the browser
//       (e.g. startAuthentication({ optionsJSON: options })). Each call
//       starts a new ceremony; it ends with the challenge.
//   401 challenge_invalid, 404 webauthn_unavailable, 409 method_unavailable
//
// Forced enrolment (after "enrolment_required"), header Authorization:
// Challenge <token of the enrolment challenge>; same operations and answers
// as the account endpoints (api/account/v1/index.ts):
// POST /enrolment/totp/start                     200 { secret, otpauthUri }
// POST /enrolment/totp/confirm                   body { code }
// POST /enrolment/webauthn/registration/options  200 { options }
// POST /enrolment/webauthn/registration/verify   body { name, response }
//   confirm / verify succeed with the sign-in completed:
//   200 { ok: true, status: "signed_in", user, session,
//         recoveryCodes: string[], credential? }
//       Store the session cookie, delete the challenge cookie, then show the
//       recovery codes (shown only this once).
//   401 challenge_invalid (also once the enrolment is done); further codes
//   as on the account endpoints.
//
// POST /reauthenticate  header Authorization: Session <token>, body { password }
//   Confirms the password for sensitive actions in this session (removing
//   a factor, new recovery codes, creating an API token).
//   200 { ok: true, reauthenticatedUntil }  ISO 8601, 10 minutes from now
//   400 validation: password: required | invalid_type
//   401 { error: "unauthenticated" }   no live session
//   403 { error: "invalid_password" }  wrong password
//   429 { error: "rate_limited" }      shares the limit of failed sign-ins
//
// GET /me       header Authorization: Session <token>
//   200 { user: { id, displayName, username, role, locale },
//         session: { rotatedToken?, expiresAt, remember } }
//       `rotatedToken` present: the token was replaced; store it in the
//       cookie (same Max-Age rule as above). The old token keeps working for
//       30 s so requests already on their way still succeed. Only /me
//       rotates tokens.
//   401 { error: "unauthenticated" }  no live session (unknown, revoked,
//       idle timeout passed without remember, past expiresAt, or an old
//       token after its 30 s): delete the cookie.
//
// POST /logout  header Authorization: Session <token>, no body
//   200 { ok: true }                  the session is revoked
//   401 { error: "unauthenticated" }  no live session for the token
//   Delete the cookie in either case.
//
// All endpoints: 413 { error: "payload_too_large" } for a body above
// AUTH_BODY_LIMIT_BYTES, 503 { error: "database_unavailable" } until the
// migrations have run, 500 { error: "internal" } on unexpected errors.
// Second-factor, enrolment and reauthenticate endpoints also answer 503
// { error: "server_not_configured" } while an instance key is missing.
// Responses are marked Cache-Control: no-store.

export const authV1 = new Hono();

authV1.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

authV1.use(
  "*",
  bodyLimit({
    maxSize: AUTH_BODY_LIMIT_BYTES,
    onError: (c) => c.json({ error: "payload_too_large" }, 413),
  }),
);

authV1.post("/login", postLogin);
authV1.post("/logout", postLogout);
authV1.get("/me", getMe);
authV1.post("/reauthenticate", postReauthenticate);
authV1.post("/second-factor/totp", postSecondFactorTotp);
authV1.post("/second-factor/recovery-code", postSecondFactorRecoveryCode);
authV1.post("/second-factor/webauthn/options", postSecondFactorWebauthnOptions);
authV1.post("/second-factor/webauthn/verify", postSecondFactorWebauthnVerify);
authV1.post("/enrolment/totp/start", postEnrolmentTotpStart);
authV1.post("/enrolment/totp/confirm", postEnrolmentTotpConfirm);
authV1.post("/enrolment/webauthn/registration/options", postEnrolmentWebauthnOptions);
authV1.post("/enrolment/webauthn/registration/verify", postEnrolmentWebauthnVerify);
