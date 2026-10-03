ALTER TABLE "instance_settings" DROP CONSTRAINT "instance_settings_default_locale_check";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_locale_check";--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_default_locale_check" CHECK ("instance_settings"."default_locale" ~ '^[a-z]{2,3}(-[A-Z]{2})?$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_locale_check" CHECK ("users"."locale" ~ '^[a-z]{2,3}(-[A-Z]{2})?$');