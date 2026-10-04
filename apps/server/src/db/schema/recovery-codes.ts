import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./id-column";
import { users } from "./users";

// Single-use recovery codes, the fallback when no second factor is at hand.
// Only a keyed digest (HMAC-SHA256 as lower-case hex) is stored; the format
// check refuses a plain code stored by mistake.
export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: idColumn(),
    // Deleting a user removes their codes.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    // Set when the code is redeemed; a used code is never accepted again.
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Also serves lookups by user (user_id is its first column).
    unique("recovery_codes_user_id_code_hash_unique").on(table.userId, table.codeHash),
    check("recovery_codes_code_hash_format_check", sql`${table.codeHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type RecoveryCode = typeof recoveryCodes.$inferSelect;
export type NewRecoveryCode = typeof recoveryCodes.$inferInsert;
