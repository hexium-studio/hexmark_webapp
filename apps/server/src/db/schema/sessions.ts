import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// Longest user agent string kept per session; the application truncates.
export const SESSION_USER_AGENT_MAX_LENGTH = 256;

// Server-side sessions of human users. The cookie holds a random token; the
// database keeps only its SHA-256 digest as lower-case hex, so a leaked table
// does not hand out usable tokens. The format check also refuses a raw token
// (base64url) stored by mistake.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Deleting a user ends all of their sessions.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique("sessions_token_hash_unique"),
    // After a rotation the previous token stays valid until previous_valid_until,
    // so requests already in flight with the old cookie still succeed.
    previousTokenHash: text("previous_token_hash"),
    previousValidUntil: timestamp("previous_valid_until", { withTimezone: true }),
    // "Remember me": no idle limit and a persistent cookie. Set explicitly at
    // sign-in, hence no default.
    remember: boolean("remember").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }).notNull().defaultNow(),
    // Absolute end of the session (created_at + maximum age), never extended.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // Last time the user re-entered the password in this session; sensitive
    // account actions require it to be recent. Null: not since sign-in.
    reauthenticatedAt: timestamp("reauthenticated_at", { withTimezone: true }),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    // token_hash is indexed by its unique constraint.
    index("sessions_previous_token_hash_idx")
      .on(table.previousTokenHash)
      .where(sql`${table.previousTokenHash} is not null`),
    check("sessions_token_hash_format_check", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "sessions_previous_token_hash_format_check",
      sql`${table.previousTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "sessions_previous_token_pair_check",
      sql`(${table.previousTokenHash} is null) = (${table.previousValidUntil} is null)`,
    ),
    check(
      "sessions_previous_token_differs_check",
      sql`${table.previousTokenHash} <> ${table.tokenHash}`,
    ),
    check("sessions_expires_after_created_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "sessions_user_agent_length_check",
      sql`char_length(${table.userAgent}) <= ${sql.raw(String(SESSION_USER_AGENT_MAX_LENGTH))}`,
    ),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
