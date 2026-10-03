// Runs once when the Next.js server starts. Reads the translation files right
// away, so problems with custom translations show in the start-up log rather
// than on the first request.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { availableLocales } = await import("./lib/locales/registry");
  availableLocales();
}
