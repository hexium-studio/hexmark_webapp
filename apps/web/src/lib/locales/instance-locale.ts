import { callServer } from "@/lib/server-api";

// GET /api/instance/v1/locale: the instance default locale, stored when the
// first admin was created (null before). Asked on requests without a saved
// or chosen locale, so it must never hold up the page: a short timeout, and
// any failure means "no instance default".

const TIMEOUT_MS = 1_000;

export async function fetchInstanceDefaultLocale(): Promise<string | undefined> {
  const response = await callServer("/api/instance/v1/locale", { timeoutMs: TIMEOUT_MS });
  if (!response.reachable || response.status !== 200) return undefined;
  const body = response.body;
  if (typeof body !== "object" || body === null || !("defaultLocale" in body)) return undefined;
  return typeof body.defaultLocale === "string" ? body.defaultLocale : undefined;
}
