import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { PASSWORD_HASH_OPTIONS } from "../config/security";

// Password hashing (Argon2id, parameters in src/config/security.ts).

export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_HASH_OPTIONS);
}

// A hash of a random password nobody knows, made once with the current
// parameters. Verifying against it costs as much as verifying a real hash.
let dummyHash: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString("base64url"));
  return dummyHash;
}

// Checks `password` against `storedHash`. With `storedHash` null (no such
// account) it verifies against the dummy hash and returns false, so an
// unknown account takes as long as a wrong password and the answer time does
// not tell which accounts exist. A malformed stored hash counts as a mismatch.
export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  const target = storedHash ?? (await getDummyHash());
  let matches: boolean;
  try {
    matches = await verify(target, password);
  } catch {
    matches = false;
  }
  return storedHash !== null && matches;
}

// Creates the dummy hash ahead of the first sign-in, so the first request
// for an unknown account is not slower than later ones.
export function warmUpPasswordVerification(): void {
  void getDummyHash().catch(() => {
    dummyHash = undefined;
  });
}
