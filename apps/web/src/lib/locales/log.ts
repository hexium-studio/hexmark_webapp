// Log lines of the locale registry, in English like all server logs, with a
// common prefix so they are easy to find in `docker compose logs web`.
export function logLocales(level: "info" | "warn" | "error", message: string): void {
  console[level](`[locales] ${message}`);
}
