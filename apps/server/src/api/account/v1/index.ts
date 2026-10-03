import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AUTH_BODY_LIMIT_BYTES } from "../../../config/security";
import { postRegenerateRecoveryCodes } from "./recovery-codes/regenerate";
import { getSecurity } from "./security";
import { postTotpConfirm } from "./totp/confirm";
import { deleteTotp } from "./totp/delete";
import { postTotpStart } from "./totp/start";
import { deleteWebauthnKey } from "./webauthn/delete";
import { postWebauthnRegistrationOptions } from "./webauthn/registration/options";
import { postWebauthnRegistrationVerify } from "./webauthn/registration/verify";
import { patchWebauthnKey } from "./webauthn/rename";

// The signed-in user's own account, version 1: second factors and recovery
// codes. Mounted at /api/account/v1 (src/api/index.ts). Types of the bodies:
// packages/shared/src/two-factor.ts.
//
// Every endpoint: header Authorization: Session <token> (as in
// api/auth/v1/index.ts); 401 { error: "unauthenticated" } without a live
// session. Tokens are not rotated here (only GET /api/auth/v1/me does).
// Marked (R): needs the password re-entered within the last 10 minutes
// (POST /api/auth/v1/reauthenticate), else 403
// { error: "reauthentication_required" }.
//
// GET /security
//   200 { totp: { enabled }, webauthn: { available, credentials: [{ id, name,
//         createdAt, lastUsedAt, deviceType, backedUp }] },
//         recoveryCodes: { remaining }, requireTwoFactor,
//         reauthenticatedUntil: string | null, timezone }
//       `webauthn.available`: the server offers security keys (PUBLIC_ORIGIN);
//       without it, listed keys can still be renamed and removed.
//       `timezone`: IANA zone for showing the account's dates (users.timezone,
//       else instance_settings.default_timezone, else "UTC").
//
// POST /totp/start  no body
//   200 { secret, otpauthUri }  base32 secret for manual entry and the
//       otpauth:// URI for the QR code. Replaces a set-up that was started
//       but not confirmed. Shown once; not readable later.
//   409 totp_already_enabled
// POST /totp/confirm  body { code }
//   200 { ok: true, recoveryCodes: string[] | null }  the app is a factor now.
//       recoveryCodes: a fresh set ("ABCD-EFGH-JKLM", 10) when this is the
//       account's first factor, shown only this once; else null.
//   400 validation (code: required | invalid_type | invalid_format)
//   401 { error: "invalid_code" }  wrong code (no attempt limit: whoever
//       confirms already holds the secret)
//   409 totp_not_pending (no /totp/start before) | totp_already_enabled
// DELETE /totp  (R)
//   200 { ok: true }  Without any factor left, the recovery codes are
//       deleted as well.
//   404 totp_not_enabled; 409 last_factor_required (the instance requires a
//   second factor and this is the last one)
//
// POST /webauthn/registration/options  no body
//   200 { options }  PublicKeyCredentialCreationOptionsJSON for the browser
//       (e.g. startRegistration({ optionsJSON: options })); valid 5 minutes.
//       Second factor only: no discoverable credential, user verification
//       preferred, no attestation; the account's keys are excluded.
//   404 webauthn_unavailable
// POST /webauthn/registration/verify  body { name (1-64, trimmed), response }
//   200 { ok: true, recoveryCodes: string[] | null, credential: { id, name,
//         createdAt, lastUsedAt, deviceType, backedUp } }
//   400 validation (name: required | invalid_type | too_long; response:
//       required | invalid); 400 webauthn_registration_failed (answer did
//       not verify, or no open ceremony for it: request new options)
//   404 webauthn_unavailable; 409 credential_exists
// PATCH /webauthn/:id  body { name }
//   200 { credential }; 400 validation; 404 credential_not_found
// DELETE /webauthn/:id  (R)
//   200 { ok: true }; 404 credential_not_found; 409 last_factor_required
//
// POST /recovery-codes/regenerate  (R), no body
//   200 { recoveryCodes: string[] }  the old codes stop working at once
//   409 second_factor_missing  (codes need a factor to stand in for)
//
// All endpoints: 413 payload_too_large, 503 database_unavailable or
// server_not_configured, 500 internal. Responses are Cache-Control: no-store.

export const accountV1 = new Hono();

accountV1.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

accountV1.use(
  "*",
  bodyLimit({
    maxSize: AUTH_BODY_LIMIT_BYTES,
    onError: (c) => c.json({ error: "payload_too_large" }, 413),
  }),
);

accountV1.get("/security", getSecurity);
accountV1.post("/totp/start", postTotpStart);
accountV1.post("/totp/confirm", postTotpConfirm);
accountV1.delete("/totp", deleteTotp);
accountV1.post("/webauthn/registration/options", postWebauthnRegistrationOptions);
accountV1.post("/webauthn/registration/verify", postWebauthnRegistrationVerify);
accountV1.patch("/webauthn/:id", patchWebauthnKey);
accountV1.delete("/webauthn/:id", deleteWebauthnKey);
accountV1.post("/recovery-codes/regenerate", postRegenerateRecoveryCodes);
