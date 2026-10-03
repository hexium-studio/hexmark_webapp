import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// Results of operations that can be refused for a reason the client must
// know: either a value, or an error code with its HTTP status and optional
// details (sent next to `error` in the JSON body). Codes, never sentences.

export interface Failure {
  ok: false;
  status: ContentfulStatusCode;
  error: string;
  details?: Record<string, unknown>;
}

export type Outcome<T> = { ok: true; value: T } | Failure;

export function succeed<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function fail(
  status: ContentfulStatusCode,
  error: string,
  details?: Record<string, unknown>,
): Failure {
  return details ? { ok: false, status, error, details } : { ok: false, status, error };
}

export function failureResponse(c: Context, failure: Failure): Response {
  return c.json({ error: failure.error, ...failure.details }, failure.status);
}

// The failure as a response, or the value turned into one by `onSuccess`.
export function sendOutcome<T>(
  c: Context,
  outcome: Outcome<T>,
  onSuccess: (value: T) => Response,
): Response {
  return outcome.ok ? onSuccess(outcome.value) : failureResponse(c, outcome);
}
