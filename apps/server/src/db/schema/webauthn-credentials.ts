import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// Longest name a user can give a security key.
export const WEBAUTHN_NAME_MAX_LENGTH = 64;

// Values of device_type (as reported by the WebAuthn library).
export const webauthnDeviceTypes = ["singleDevice", "multiDevice"] as const;

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// Security keys and passkeys registered as a second factor (WebAuthn).
export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Deleting a user removes their keys.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Credential ID from the authenticator as base64url (at most 1023 bytes,
    // i.e. 1364 characters). Unique across all users.
    credentialId: text("credential_id")
      .notNull()
      .unique("webauthn_credentials_credential_id_unique"),
    // COSE-encoded public key.
    publicKey: bytea("public_key").notNull(),
    // Signature counter; authenticators without one always report 0.
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    // Transport hints (e.g. "usb", "nfc", "internal"); null when not reported.
    transports: text("transports").array(),
    name: text("name").notNull(),
    aaguid: text("aaguid"),
    deviceType: text("device_type", { enum: webauthnDeviceTypes }),
    backedUp: boolean("backed_up").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    index("webauthn_credentials_user_id_idx").on(table.userId),
    check(
      "webauthn_credentials_credential_id_format_check",
      sql`${table.credentialId} ~ '^[A-Za-z0-9_-]+$' and char_length(${table.credentialId}) <= 1364`,
    ),
    check(
      "webauthn_credentials_name_length_check",
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(WEBAUTHN_NAME_MAX_LENGTH))}`,
    ),
    check("webauthn_credentials_counter_check", sql`${table.counter} >= 0`),
    check(
      "webauthn_credentials_device_type_check",
      sql`${table.deviceType} in ('singleDevice', 'multiDevice')`,
    ),
  ],
);

export type WebauthnCredential = typeof webauthnCredentials.$inferSelect;
export type NewWebauthnCredential = typeof webauthnCredentials.$inferInsert;
