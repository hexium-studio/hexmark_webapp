import { instanceSecrets } from "../../config/secrets";
import type { Keyring } from "../../lib/crypto";

// The instance's encryption keys (ENCRYPTION_KEY and the optional previous
// one). Every endpoint that reaches second-factor code refuses earlier while
// the keys are not configured (serverNotConfigured), so a missing keyring
// here is a programming error.
export function encryptionKeyring(): Keyring {
  const keyring = instanceSecrets().encryption;
  if (!keyring) throw new Error("ENCRYPTION_KEY is not configured");
  return keyring;
}
