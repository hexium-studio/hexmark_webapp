// What went wrong in the browser's part of a WebAuthn ceremony, as a code
// the page translates like the server's refusals (messages
// "twoFactor.errors.<code>").

export type BrowserWebauthnError =
  // Cancelled, timed out, or no matching key touched (NotAllowedError).
  | "webauthn_cancelled"
  // The key is registered on this account already (InvalidStateError).
  | "credential_exists"
  // Anything else the browser or the key reported.
  | "webauthn_browser_failed";

// `error` as thrown by @simplewebauthn/browser (a WebAuthnError with a
// `code`, or the browser's own DOMException).
export function browserWebauthnError(error: unknown): BrowserWebauthnError {
  const code = (error as { code?: unknown })?.code;
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return "credential_exists";
  if (code === "ERROR_CEREMONY_ABORTED") return "webauthn_cancelled";
  const name = (error as { name?: unknown })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return "webauthn_cancelled";
  if (name === "InvalidStateError") return "credential_exists";
  return "webauthn_browser_failed";
}
