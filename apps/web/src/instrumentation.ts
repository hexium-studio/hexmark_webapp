// Runs once when the Next.js server starts.
//   - Installs the hook that records each request's peer address
//     (lib/client-origin/peer-address-hook.ts), before the first request.
//   - Logs the trusted proxy settings and a missing or invalid
//     INTERNAL_API_KEY (lib/internal-key.ts).
//   - Reads the translation files right away, so problems with custom
//     translations show in the start-up log rather than on the first request.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installPeerAddressHook } = await import("./lib/client-origin/peer-address-hook");
  installPeerAddressHook();
  const { trustConfig } = await import("./lib/client-origin/trusted-proxies");
  trustConfig();
  const { reportInternalKey } = await import("./lib/internal-key");
  reportInternalKey();
  const { availableLocales } = await import("./lib/locales/registry");
  availableLocales();
}
