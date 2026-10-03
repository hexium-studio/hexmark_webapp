// Lifetimes and limits of second factors, challenges and recovery codes.

const MINUTE = 60_000;

// How long each kind of challenge (src/db/schema/auth-challenges.ts) stays
// usable after it was issued.
export const CHALLENGE_LIFETIME_MS = {
  // Sign-in waiting for the second factor.
  second_factor: 5 * MINUTE,
  // Sign-in waiting for the account to add its first factor (scanning a QR
  // code takes longer than typing a code).
  enrolment: 15 * MINUTE,
  // Setup wizard steps 5 and 6 after the first admin was created.
  setup_enrolment: 15 * MINUTE,
  // One WebAuthn ceremony (options issued, browser answer pending).
  webauthn_registration: 5 * MINUTE,
  webauthn_authentication: 5 * MINUTE,
} as const;

// Wrong answers one sign-in challenge accepts; the last one burns it.
export const CHALLENGE_MAX_ATTEMPTS = 5;

// Random bytes of a challenge or ticket token (base64url, 43 characters).
export const CHALLENGE_TOKEN_BYTES = 32;

// Sensitive account actions need the password re-entered within this time.
export const REAUTHENTICATION_WINDOW_MS = 10 * MINUTE;

// TOTP (RFC 6238) as authenticator apps expect it by default: HMAC-SHA1,
// 6 digits, 30-second steps. One step before and after the current one is
// accepted for clock drift.
export const TOTP_PARAMETERS = {
  digits: 6,
  stepSeconds: 30,
  window: 1,
  // 160-bit secrets, the size RFC 4226 recommends for HMAC-SHA1.
  secretBytes: 20,
} as const;

// Shown in authenticator apps next to the account name.
export const TOTP_ISSUER = "Hexmark";

// Info string of the HKDF step that turns ENCRYPTION_KEY into the key for
// recovery code digests. Changing it invalidates every stored code.
export const RECOVERY_CODE_HMAC_INFO = "hexmark/recovery-codes/hmac-sha256/v1";

// WebAuthn ceremony timeout passed to the browser.
export const WEBAUTHN_TIMEOUT_MS = 2 * MINUTE;
