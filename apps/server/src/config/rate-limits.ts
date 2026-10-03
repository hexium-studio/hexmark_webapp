// Limits for failed attempts, applied with the mechanism in src/lib/rate-limiter.ts.

// Setup token attempts (POST /api/setup/v1/verify-token and
// POST /api/setup/v1/create-first-admin): per source address and across all
// addresses, within one sliding window. See src/api/setup/_lib/setup-attempts.ts.
export const SETUP_RATE_LIMIT = {
  perAddress: 5,
  global: 20,
  windowMinutes: 15,
} as const;
