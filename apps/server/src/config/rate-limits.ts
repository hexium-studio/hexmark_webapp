// Limits for failed attempts, applied with the mechanism in src/lib/rate-limiter.ts.

// Setup token attempts (POST /api/setup/v1/verify-token and
// POST /api/setup/v1/create-first-admin): per source address and across all
// addresses, within one sliding window. See src/api/setup/_lib/setup-attempts.ts.
export const SETUP_RATE_LIMIT = {
  perAddress: 5,
  global: 20,
  windowMinutes: 15,
} as const;

// Failed sign-ins (POST /api/auth/v1/login with wrong e-mail or password):
// per source address and across all addresses, within one sliding window.
// See src/api/auth/_lib/login-attempts.ts.
export const LOGIN_RATE_LIMIT = {
  perAddress: 10,
  global: 50,
  windowMinutes: 15,
} as const;

// Wrong second-factor answers at sign-in (POST /api/auth/v1/second-factor/*):
// per source address and across all addresses, within one sliding window.
// Each challenge has its own, smaller limit on top (src/config/two-factor.ts).
// See src/api/auth/_lib/second-factor-attempts.ts.
export const SECOND_FACTOR_RATE_LIMIT = {
  perAddress: 10,
  global: 50,
  windowMinutes: 15,
} as const;
