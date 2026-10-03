import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { SETUP_BODY_LIMIT_BYTES } from "../../../config/security";
import { createFirstAdminAccount } from "./create-first-admin";
import { getSetupStatus } from "./status";
import { putSystemSettings } from "./system-settings";
import { getSetupTwoFactorStatus } from "./two-factor/status";
import { postSetupTotpConfirm } from "./two-factor/totp/confirm";
import { postSetupTotpStart } from "./two-factor/totp/start";
import { postSetupWebauthnOptions } from "./two-factor/webauthn/registration/options";
import { postSetupWebauthnVerify } from "./two-factor/webauthn/registration/verify";
import { verifySetupToken } from "./verify-token";

// First-run setup, version 1. Mounted at /api/setup/v1 (src/api/index.ts).
//
// GET /status, POST /verify-token, POST /create-first-admin: see the files.
// create-first-admin answers 201 { ok: true, ticket: { token, expiresAt } }:
// the setup enrolment ticket for the wizard's steps 5 (second factor) and 6
// (system settings). Sign-in stays refused while SETUP_TOKEN is set, so these
// steps act with the ticket instead of a session. The web server keeps the
// token in the httpOnly cookie `hexmark_challenge` and passes it on as
// `Authorization: Challenge <token>`. It is bound to the new admin, valid
// 15 minutes and only for the endpoints below, and used up when the system
// settings are saved. Without a usable ticket: 401 { error:
// "challenge_invalid" }.
//
// GET /two-factor/status
//   200 { totp: { enabled }, webauthn: { available, credentials },
//         recoveryCodes: { remaining }, requireTwoFactor }
//       as GET /api/account/v1/security, without reauthenticatedUntil.
//       Step 6 enables "require two-factor" only when totp.enabled or
//       credentials is not empty.
// POST /two-factor/totp/start                     200 { secret, otpauthUri }
// POST /two-factor/totp/confirm                   body { code }
//   200 { ok: true, recoveryCodes: string[] | null }
// POST /two-factor/webauthn/registration/options  200 { options }
// POST /two-factor/webauthn/registration/verify   body { name, response }
//   200 { ok: true, recoveryCodes: string[] | null, credential }
//   Answers and error codes as the account endpoints
//   (api/account/v1/index.ts); the ticket stays valid for step 6.
//
// PUT /system-settings  body { timezone: IANA name, requireTwoFactor: boolean }
//   200 { ok: true }  saved; the ticket is used up (setup is complete).
//       `timezone` is stored as Intl spells it ("europe/berlin" ->
//       "Europe/Berlin"); "UTC" is valid.
//   400 validation: timezone: required | invalid_option;
//       requireTwoFactor: required | invalid_type
//   409 { error: "second_factor_missing" }  requireTwoFactor without a
//       factor on the admin's account (back to step 5)
//
// Ticket endpoints also answer 503 database_unavailable or
// server_not_configured, 413 payload_too_large and 500 internal.

export const setupV1 = new Hono();

// The setup forms are tiny; refuse anything larger before parsing it.
setupV1.use(
  "*",
  bodyLimit({
    maxSize: SETUP_BODY_LIMIT_BYTES,
    onError: (c) => c.json({ error: "payload_too_large" }, 413),
  }),
);

// Tickets and second-factor secrets must not be cached.
setupV1.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

setupV1.get("/status", getSetupStatus);
setupV1.post("/verify-token", verifySetupToken);
setupV1.post("/create-first-admin", createFirstAdminAccount);
setupV1.get("/two-factor/status", getSetupTwoFactorStatus);
setupV1.post("/two-factor/totp/start", postSetupTotpStart);
setupV1.post("/two-factor/totp/confirm", postSetupTotpConfirm);
setupV1.post("/two-factor/webauthn/registration/options", postSetupWebauthnOptions);
setupV1.post("/two-factor/webauthn/registration/verify", postSetupWebauthnVerify);
setupV1.put("/system-settings", putSystemSettings);
