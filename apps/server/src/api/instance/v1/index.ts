import { Hono } from "hono";
import { getCapabilities } from "./capabilities";
import { getInstanceLocale } from "./locale";

// Instance-wide information and settings, version 1. Mounted at
// /api/instance/v1 (src/api/index.ts).
//
// GET /locale        see locale.ts
// GET /capabilities  200 { webauthn: boolean }  whether the server offers
//   security keys and passkeys (PUBLIC_ORIGIN is set and valid). Public: it
//   tells only what the sign-in and account pages may offer. The browser
//   additionally needs a secure context and WebAuthn support.

export const instanceV1 = new Hono();

instanceV1.get("/locale", getInstanceLocale);
instanceV1.get("/capabilities", getCapabilities);
