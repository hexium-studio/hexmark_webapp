ALTER TABLE "api_token_entries" DROP CONSTRAINT "api_token_entries_permissions_check";--> statement-breakpoint
ALTER TABLE "api_tokens" DROP CONSTRAINT "api_tokens_permissions_check";--> statement-breakpoint
ALTER TABLE "api_tokens" DROP CONSTRAINT "api_tokens_base_permissions_check";--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "hidden_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "hidden_by_token_id" uuid;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "hidden_by_name" text;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "hide_reason" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "hidden_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "hidden_by_token_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "hidden_by_name" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "hide_reason" text;--> statement-breakpoint
-- notes.hidden was a plain flag without rules or any way to set it (no API,
-- no tool, no UI). It becomes a value PostgreSQL derives from hidden_at, so
-- a server of the previous version, which still selects it, keeps working.
-- A note flagged by hand gets hidden_at = the time of this migration and the
-- system as actor, without a reason: when or by whom it was flagged was
-- never recorded, and the flag had no effect before now, so this migration
-- is the moment the note actually becomes hidden. No other row changes.
UPDATE "notes" SET "hidden_at" = now(), "hidden_by_name" = 'System' WHERE "hidden";--> statement-breakpoint
ALTER TABLE "notes" drop column "hidden";--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "hidden" boolean GENERATED ALWAYS AS ("hidden_at" is not null) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_hidden_by_user_id_users_id_fk" FOREIGN KEY ("hidden_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_hidden_by_token_id_api_tokens_id_fk" FOREIGN KEY ("hidden_by_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_hidden_by_user_id_users_id_fk" FOREIGN KEY ("hidden_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_hidden_by_token_id_api_tokens_id_fk" FOREIGN KEY ("hidden_by_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folders_hidden_at_idx" ON "folders" USING btree ("hidden_at") WHERE "folders"."hidden_at" is not null;--> statement-breakpoint
CREATE INDEX "notes_hidden_at_idx" ON "notes" USING btree ("hidden_at") WHERE "notes"."hidden_at" is not null;--> statement-breakpoint
-- The permission checks are dropped above and added again below with the
-- new permission hide (also for note entries); every value they accepted
-- before is still accepted.
ALTER TABLE "api_token_entries" ADD CONSTRAINT "api_token_entries_permissions_check" CHECK (("api_token_entries"."token_access_mode" = 'deny_list' and "api_token_entries"."permissions" is null) or ("api_token_entries"."token_access_mode" = 'allow_list' and "api_token_entries"."permissions" is not null and cardinality("api_token_entries"."permissions") > 0 and array_ndims("api_token_entries"."permissions") = 1 and "api_token_entries"."permissions" <@ (case "api_token_entries"."target_kind" when 'folder' then ARRAY['read', 'search', 'create', 'edit', 'move', 'delete', 'lock', 'hide']::text[] else ARRAY['read', 'edit', 'move', 'delete', 'lock', 'hide']::text[] end)));--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_permissions_check" CHECK (cardinality("api_tokens"."permissions") > 0 and array_ndims("api_tokens"."permissions") = 1 and "api_tokens"."permissions" <@ ARRAY['read', 'search', 'create', 'edit', 'move', 'delete', 'lock', 'hide']::text[]);--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_base_permissions_check" CHECK (cardinality("api_tokens"."base_permissions") > 0 and array_ndims("api_tokens"."base_permissions") = 1 and "api_tokens"."base_permissions" <@ ARRAY['read', 'search', 'create', 'edit', 'move', 'delete', 'lock', 'hide']::text[]);--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_hidden_by_single_id_check" CHECK (num_nonnulls("folders"."hidden_by_user_id", "folders"."hidden_by_token_id") <= 1);--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_hidden_by_name_length_check" CHECK (char_length("folders"."hidden_by_name") between 1 and 64);--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_hidden_by_pairing_check" CHECK (("folders"."hidden_at" is null and "folders"."hidden_by_user_id" is null and "folders"."hidden_by_token_id" is null and "folders"."hidden_by_name" is null) or ("folders"."hidden_at" is not null and "folders"."hidden_by_name" is not null));--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_hide_reason_check" CHECK ("folders"."hide_reason" is null or ("folders"."hidden_at" is not null and char_length("folders"."hide_reason") between 1 and 500 and "folders"."hide_reason" ~ '[^[:space:]]'));--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_hidden_by_single_id_check" CHECK (num_nonnulls("notes"."hidden_by_user_id", "notes"."hidden_by_token_id") <= 1);--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_hidden_by_name_length_check" CHECK (char_length("notes"."hidden_by_name") between 1 and 64);--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_hidden_by_pairing_check" CHECK (("notes"."hidden_at" is null and "notes"."hidden_by_user_id" is null and "notes"."hidden_by_token_id" is null and "notes"."hidden_by_name" is null) or ("notes"."hidden_at" is not null and "notes"."hidden_by_name" is not null));--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_hide_reason_check" CHECK ("notes"."hide_reason" is null or ("notes"."hidden_at" is not null and char_length("notes"."hide_reason") between 1 and 500 and "notes"."hide_reason" ~ '[^[:space:]]'));