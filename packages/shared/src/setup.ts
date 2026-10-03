import { z } from "zod";
import { type FieldErrorCode, requiredOr } from "./field-errors";
import { localeSchema } from "./locale";

// Schemas for the first-run setup (creating the first admin). Shared by the
// server, which enforces them, and the web app, which can check input early.

// Number of characters of SETUP_TOKEN. Everything below, the server's checks
// and the wizard's input cells derive from it.
export const SETUP_TOKEN_LENGTH = 8;

// Format of SETUP_TOKEN after normalisation (trimmed, upper-cased).
export const SETUP_TOKEN_PATTERN = new RegExp(`^[A-Z0-9]{${SETUP_TOKEN_LENGTH}}$`);

// SETUP_TOKEN_PATTERN in words, for log lines and hints.
export const SETUP_TOKEN_FORMAT_HINT = `exactly ${SETUP_TOKEN_LENGTH} characters, A-Z and 0-9`;

// The one token schema: used for the environment variable on the server and
// for the value typed into the wizard, so both normalise the same way. The
// format check is a refinement (not .regex) so its issue carries `length`.
export const setupTokenSchema = z
  .string({ error: requiredOr("invalid_type") })
  .trim()
  .toUpperCase()
  .refine((token) => SETUP_TOKEN_PATTERN.test(token), {
    message: "invalid_format",
    params: { length: SETUP_TOKEN_LENGTH },
  });

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

// Messages are field error codes (field-errors.ts); lengths reach the client
// as params of too_short / too_long, so they are written down only here.
const code = (value: FieldErrorCode) => value;

// Length limits of the account fields. The setup form shows them as its
// rules, so they are written down only here.
export const ACCOUNT_LIMITS = {
  displayName: { min: 1, max: 64 },
  username: { min: 3, max: 32 },
  password: { min: 12, max: 128 },
} as const;

// Every check of a field runs, so a failed parse lists all of its broken
// rules (the setup form marks each rule on its own).
export const displayNameSchema = z
  .string({ error: requiredOr("invalid_type") })
  .trim()
  .min(ACCOUNT_LIMITS.displayName.min, code("required"))
  .max(ACCOUNT_LIMITS.displayName.max, code("too_long"));

export const usernameSchema = z
  .string({ error: requiredOr("invalid_type") })
  .trim()
  .toLowerCase()
  .min(ACCOUNT_LIMITS.username.min, code("too_short"))
  .max(ACCOUNT_LIMITS.username.max, code("too_long"))
  .regex(USERNAME_PATTERN, code("invalid_format"));

// E-mail as stored and compared: trimmed and lower-cased. Also the sign-in
// e-mail (auth.ts).
export const emailSchema = z
  .string({ error: requiredOr("invalid_type") })
  .trim()
  .toLowerCase()
  .min(1, code("required"))
  .max(254, code("too_long"))
  .pipe(z.email(code("invalid_email")));

// No composition rules on purpose: length is what makes a password strong.
export const passwordSchema = z
  .string({ error: requiredOr("invalid_type") })
  .min(ACCOUNT_LIMITS.password.min, code("too_short"))
  .max(ACCOUNT_LIMITS.password.max, code("too_long"));

export const setupInputSchema = z
  .object({
    displayName: displayNameSchema,
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string({ error: requiredOr("invalid_type") }).min(1, code("required")),
    setupToken: setupTokenSchema,
    // UI language chosen in the wizard: the admin's locale and the instance default.
    locale: localeSchema,
  })
  // An empty confirmation reports "required" above; the mismatch check
  // skips it so the field reports a single problem.
  .refine((input) => input.passwordConfirm === "" || input.password === input.passwordConfirm, {
    path: ["passwordConfirm"],
    message: code("mismatch"),
  });

export type SetupInput = z.infer<typeof setupInputSchema>;

// Body of POST /api/setup/v1/verify-token.
export const verifyTokenInputSchema = z.object({ setupToken: setupTokenSchema });

export type VerifyTokenInput = z.infer<typeof verifyTokenInputSchema>;

// Body of a 200 response from GET /api/setup/v1/status.
export const setupStatusSchema = z.object({
  // True only when the database confirms that no user exists.
  setupOpen: z.boolean(),
  // SETUP_TOKEN is set in the server environment (any value).
  setupTokenPresent: z.boolean(),
  // SETUP_TOKEN is set and has the required format.
  setupTokenConfigured: z.boolean(),
  // INTERNAL_API_KEY and ENCRYPTION_KEY are set and valid.
  secretsConfigured: z.boolean(),
  database: z.object({
    reachable: z.boolean(),
    migrated: z.boolean(),
  }),
});

export type SetupStatus = z.infer<typeof setupStatusSchema>;
