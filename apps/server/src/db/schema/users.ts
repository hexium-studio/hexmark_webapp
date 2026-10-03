import { DEFAULT_LOCALE, LOCALE_PATTERN, type Locale } from "@hexmark/shared";
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Role presets; explicit permissions are added in a later migration.
export const userRoles = ["admin", "user", "guest"] as const;
export type UserRole = (typeof userRoles)[number];

// UI language codes are open-ended (user-supplied translation files), so the
// database checks their form only, with LOCALE_PATTERN from @hexmark/shared as
// a PostgreSQL regular expression (used here and in instance-settings.ts). The
// pattern uses no syntax that differs between JavaScript and PostgreSQL;
// changing it needs a migration (see 0002).
export const localeCheckPattern = sql.raw(`'${LOCALE_PATTERN.source}'`);

// Human accounts. The application normalises email (trimmed, lower-cased) and
// username (lower-cased); the check constraints make the database refuse
// anything else, so the plain unique constraints are case-insensitive in effect.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique("users_email_unique"),
    username: text("username").notNull().unique("users_username_unique"),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: userRoles }).notNull(),
    // Preferred UI language. Rows created before migration 0001 get 'en': until
    // then the UI existed in English only, so that is what those users saw.
    locale: text("locale").$type<Locale>().notNull().default(DEFAULT_LOCALE),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("users_role_check", sql`${table.role} in ('admin', 'user', 'guest')`),
    check("users_locale_check", sql`${table.locale} ~ ${localeCheckPattern}`),
    check("users_email_normalized_check", sql`${table.email} = lower(btrim(${table.email}))`),
    check("users_username_normalized_check", sql`${table.username} = lower(${table.username})`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
