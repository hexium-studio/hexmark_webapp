import { DEFAULT_LOCALE, type Locale } from "@hexmark/shared";
import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { localeCheckPattern } from "./users";

// Instance-wide settings as a single row (id is always 1) with typed columns;
// further settings become further columns. The row is written when the first
// admin is created.
export const instanceSettings = pgTable(
  "instance_settings",
  {
    id: smallint("id").primaryKey().default(1),
    // UI language for visitors without a saved or chosen locale.
    defaultLocale: text("default_locale").$type<Locale>().notNull().default(DEFAULT_LOCALE),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("instance_settings_single_row_check", sql`${table.id} = 1`),
    check(
      "instance_settings_default_locale_check",
      sql`${table.defaultLocale} ~ ${localeCheckPattern}`,
    ),
  ],
);

export type InstanceSettings = typeof instanceSettings.$inferSelect;
export type NewInstanceSettings = typeof instanceSettings.$inferInsert;
