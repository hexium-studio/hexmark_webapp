// For the log only (status reasons stay generic). Drizzle wraps driver
// errors ("Failed query: ...") and Node reports refused connections as an
// AggregateError with an empty message, so report the innermost cause and
// fall back to its error code. Driver messages name host, port or user at
// most, never the password. Skipping the Drizzle wrapper also keeps query
// parameters (user input, hashes) out of the log.
export function describeError(error: unknown): string {
  let current: unknown = error;
  while (current instanceof Error && current.cause !== undefined) current = current.cause;
  if (!(current instanceof Error)) return String(current);
  const code = (current as { code?: unknown }).code;
  const message = current.message.trim();
  if (message && typeof code === "string" && !message.includes(code)) return `${message} (${code})`;
  return message || (typeof code === "string" ? code : current.name);
}
