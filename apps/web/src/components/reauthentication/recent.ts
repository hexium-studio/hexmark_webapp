import type { FactorFailure } from "@/lib/two-factor/factor-result";

export type ReauthenticateResult = { ok: true; until: string } | FactorFailure;

// Whether the last password confirmation still covers an action now, with
// a few seconds to spare for the round trip.
const MARGIN_MS = 5_000;

export function isRecentlyConfirmed(until: string | null, now = Date.now()): boolean {
  if (!until) return false;
  const end = Date.parse(until);
  return !Number.isNaN(end) && end - MARGIN_MS > now;
}
