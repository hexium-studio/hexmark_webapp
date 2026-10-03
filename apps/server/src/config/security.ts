import type { Algorithm, Options } from "@node-rs/argon2";

// Security parameters of the server. Input rules that the browser checks as
// well (e.g. the setup token format) live in @hexmark/shared and are imported
// from there, not repeated here.

// `Algorithm` is a const enum that cannot be imported as a value with
// isolatedModules; 2 is Algorithm.Argon2id.
const ARGON2ID = 2 as Algorithm;

// Argon2id with 19 MiB memory, 2 passes and 1 lane: the library defaults,
// which match the OWASP minimum recommendation. Changing them only affects new
// hashes; the parameters are stored in each hash.
export const PASSWORD_HASH_OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

// Largest accepted request body for the setup endpoints; the forms are tiny.
export const SETUP_BODY_LIMIT_BYTES = 16 * 1024;

// Largest accepted request body for the sign-in endpoints.
export const AUTH_BODY_LIMIT_BYTES = 16 * 1024;
