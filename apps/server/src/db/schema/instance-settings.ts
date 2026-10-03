import { DEFAULT_LOCALE, type Locale } from "@hexmark/shared";
import { sql } from "drizzle-orm";
import { boolean, check, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { localeCheckPattern, timezoneCheckPattern } from "./users";

// Instance-wide settings as a single row (id is always 1) with typed columns;
// further settings become further columns. The row is written when the first
// admin is created.
export const instanceSettings = pgTable(
  "instance_settings",
  {
    id: smallint("id").primaryKey().default(1),
    // UI language for visitors without a saved or chosen locale.
    defaultLocale: text("default_locale").$type<Locale>().notNull().default(DEFAULT_LOCALE),
    // Time zone for showing dates to users without their own (IANA name;
    // timestamps are stored in UTC). An instance set up before migration 0004
    // gets 'UTC': it had no time zone setting, so UTC - the zone the
    // timestamps are stored in - is the only value that adds no assumption.
    defaultTimezone: text("default_timezone").notNull().default("UTC"),
    // Every user must have a second factor before a session becomes active.
    // Instances from before migration 0004 get false: second factors did not
    // exist then, so nobody could have been required to have one.
    requireTwoFactor: boolean("require_two_factor").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("instance_settings_single_row_check", sql`${table.id} = 1`),
    check(
      "instance_settings_default_locale_check",
      sql`${table.defaultLocale} ~ ${localeCheckPattern}`,
    ),
    check(
      "instance_settings_default_timezone_check",
      sql`${table.defaultTimezone} ~ ${timezoneCheckPattern}`,
    ),
  ],
);

export type InstanceSettings = typeof instanceSettings.$inferSelect;
export type NewInstanceSettings = typeof instanceSettings.$inferInsert;
