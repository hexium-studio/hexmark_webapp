CREATE TABLE "instance_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"default_locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_single_row_check" CHECK ("instance_settings"."id" = 1),
	CONSTRAINT "instance_settings_default_locale_check" CHECK ("instance_settings"."default_locale" in ('en', 'de'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_locale_check" CHECK ("users"."locale" in ('en', 'de'));