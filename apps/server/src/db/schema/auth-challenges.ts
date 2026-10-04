import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { idColumn } from "./id-column";
import { users } from "./users";

// What a challenge authorises. Changing the list needs a migration of
// auth_challenges_purpose_check below.
export const authChallengePurposes = [
  // Password accepted, the second factor is still missing.
  "second_factor",
  // Password accepted, but the instance requires a second factor the user lacks.
  "enrolment",
  // Second factor and system settings during the setup wizard.
  "setup_enrolment",
  // A pending WebAuthn ceremony (its challenge is in webauthn_challenge).
  "webauthn_registration",
  "webauthn_authentication",
] as const;

// Short-lived, single-use tokens for the steps between "password accepted" and
// "session active". As with sessions, the client holds a random token and the
// database keeps only its SHA-256 digest as lower-case hex.
export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: idColumn(),
    // Deleting a user removes their open challenges.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique("auth_challenges_token_hash_unique"),
    purpose: text("purpose", { enum: authChallengePurposes }).notNull(),
    // Challenge of a pending WebAuthn ceremony (base64url), checked when the
    // browser answers.
    webauthnChallenge: text("webauthn_challenge"),
    // "Remember me" from the sign-in form, carried over to the session.
    remember: boolean("remember").notNull().default(false),
    // Wrong answers so far; the application burns the challenge at its limit.
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Set when the challenge has been used up.
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("auth_challenges_user_id_idx").on(table.userId),
    // Removing expired challenges.
    index("auth_challenges_expires_at_idx").on(table.expiresAt),
    check("auth_challenges_token_hash_format_check", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "auth_challenges_purpose_check",
      sql`${table.purpose} in ('second_factor', 'enrolment', 'setup_enrolment', 'webauthn_registration', 'webauthn_authentication')`,
    ),
    check(
      "auth_challenges_webauthn_challenge_format_check",
      sql`${table.webauthnChallenge} ~ '^[A-Za-z0-9_-]{16,255}$'`,
    ),
    // A WebAuthn ceremony cannot be checked without its challenge.
    check(
      "auth_challenges_webauthn_purpose_check",
      sql`${table.purpose} not in ('webauthn_registration', 'webauthn_authentication') or ${table.webauthnChallenge} is not null`,
    ),
    check("auth_challenges_attempts_check", sql`${table.attempts} >= 0`),
    check(
      "auth_challenges_expires_after_created_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export type AuthChallenge = typeof authChallenges.$inferSelect;
export type NewAuthChallenge = typeof authChallenges.$inferInsert;
