import { hash } from "@node-rs/argon2";
import { PASSWORD_HASH_OPTIONS } from "../config/security";

// Password hashing (Argon2id, parameters in src/config/security.ts).

export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_HASH_OPTIONS);
}
