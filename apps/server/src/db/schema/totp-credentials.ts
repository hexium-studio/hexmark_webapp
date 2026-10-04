import { sql } from "drizzle-orm";
import { bigint, check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./id-column";
import { users } from "./users";

// A user's authenticator app (TOTP, RFC 6238): at most one per user.
export const totpCredentials = pgTable(
  "totp_credentials",
  {
    id: idColumn(),
    // Deleting a user removes the credential. The unique constraint also
    // indexes lookups by user.
    userId: uuid("user_id")
      .notNull()
      .unique("totp_credentials_user_id_unique")
      .references(() => users.id, { onDelete: "cascade" }),
    // The shared secret, encrypted with the instance key (format of
    // lib/crypto.ts: "v<n>.<key id>.<base64url>"). The format check refuses a
    // plain secret (base32) stored by mistake.
    secretEncrypted: text("secret_encrypted").notNull(),
    // Null while the setup is pending (the user has not entered a code yet);
    // only confirmed credentials count as a second factor.
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    // Time step of the last accepted code, so the same code cannot be used twice.
    lastUsedStep: bigint("last_used_step", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "totp_credentials_secret_encrypted_format_check",
      sql`${table.secretEncrypted} ~ '^v[0-9]+\\.[A-Za-z0-9_-]{1,32}\\.[A-Za-z0-9_-]+$'`,
    ),
    check("totp_credentials_last_used_step_check", sql`${table.lastUsedStep} >= 0`),
  ],
);

export type TotpCredential = typeof totpCredentials.$inferSelect;
export type NewTotpCredential = typeof totpCredentials.$inferInsert;
