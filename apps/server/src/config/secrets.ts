import { createHash } from "node:crypto";
import {
  INTERNAL_KEY_ENV,
  type InstanceKeyState,
  instanceKeyState,
  parseInstanceKey,
} from "@hexmark/shared/internal-calls";
import { createKeyring, type Keyring } from "../lib/crypto";

// Instance keys from .env, both required, both 32 random bytes in base64url
// (format and generation: @hexmark/shared/internal-calls):
//
//   INTERNAL_API_KEY         shared with the web server; it presents the key to
//                            be trusted with the browser's address
//                            (src/services/client-address.ts)
//   ENCRYPTION_KEY           encrypts data at rest (src/lib/crypto.ts)
//   ENCRYPTION_KEY_PREVIOUS  optional, decrypt only: the key ENCRYPTION_KEY
//                            replaced, so values sealed with it stay readable
//
// A key's id in sealed values is derived from the key itself, so nothing
// else has to be configured to change keys.
//
// The server always starts. While a key is missing or invalid, the setup
// wizard reports it (GET /api/setup/v1/status), and creating the first admin
// and signing in are refused (serverNotConfigured below). Values are never
// logged, only the names of the variables.

export const ENCRYPTION_KEY_ENV = "ENCRYPTION_KEY";
export const ENCRYPTION_KEY_PREVIOUS_ENV = "ENCRYPTION_KEY_PREVIOUS";

export interface InstanceSecrets {
  internalApiKey: string | null;
  encryption: Keyring | null;
  // "<variable> is missing" / "<variable> is invalid", for the log.
  problems: string[];
}

// Short, stable id of a key: the start of a SHA-256 over it. Reveals
// nothing usable about a 256-bit random key.
export function keyId(key: Buffer): string {
  return createHash("sha256")
    .update("hexmark-key-id:")
    .update(key)
    .digest()
    .subarray(0, 6)
    .toString("base64url");
}

function problem(variable: string, state: InstanceKeyState): string[] {
  return state === "valid" ? [] : [`${variable} is ${state}`];
}

export function readInstanceSecrets(source: NodeJS.ProcessEnv = process.env): InstanceSecrets {
  const internalState = instanceKeyState(source[INTERNAL_KEY_ENV]);
  const currentState = instanceKeyState(source[ENCRYPTION_KEY_ENV]);
  const previousRaw = source[ENCRYPTION_KEY_PREVIOUS_ENV];
  const previousState = instanceKeyState(previousRaw);
  const problems = [
    ...problem(INTERNAL_KEY_ENV, internalState),
    ...problem(ENCRYPTION_KEY_ENV, currentState),
    // Optional: only a set but invalid value is a problem.
    ...(previousState === "invalid" ? problem(ENCRYPTION_KEY_PREVIOUS_ENV, "invalid") : []),
  ];

  const current = parseInstanceKey(source[ENCRYPTION_KEY_ENV]);
  let encryption: Keyring | null = null;
  if (current) {
    const keys: [string, Buffer][] = [[keyId(current), current]];
    const previous = parseInstanceKey(previousRaw);
    if (previous && !previous.equals(current)) keys.push([keyId(previous), previous]);
    encryption = createKeyring(keyId(current), keys);
  }
  return {
    internalApiKey: internalState === "valid" ? (source[INTERNAL_KEY_ENV]?.trim() ?? null) : null,
    encryption,
    problems,
  };
}

let loaded: InstanceSecrets | undefined;

// The keys of this process, read from the environment once.
export function instanceSecrets(): InstanceSecrets {
  loaded ??= readInstanceSecrets();
  return loaded;
}

// The one rule for "may this server create accounts and sessions": every
// required key is present and valid. Asked by the setup guard
// (src/api/setup/_lib/guard.ts) and the sign-in policy
// (src/api/auth/_lib/sign-in-policy.ts).
export function serverNotConfigured(): boolean {
  return instanceSecrets().problems.length > 0;
}

// Start-up log: names of missing or invalid variables, never values.
export function reportInstanceSecrets(): void {
  const { problems } = instanceSecrets();
  if (problems.length === 0) return;
  console.error(
    `Server configuration incomplete: ${problems.join(", ")}. Set the keys in .env ` +
      "(see .env.example) and restart; until then setup and sign-in are refused.",
  );
}
