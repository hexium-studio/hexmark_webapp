ALTER TABLE "api_tokens" ALTER COLUMN "permissions" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "access_mode" text;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "base_permissions" text[];--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "locked_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "locked_by_token_id" uuid;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "locked_by_name" text;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "lock_reason" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "lock_reason" text;--> statement-breakpoint
-- Every existing token gets an access mode, decided by its old folder scope
-- (null meant the whole wiki):
-- - no scope: deny_list with an empty deny list, and its permissions as the
--   base set, which is exactly the whole wiki with the same permissions;
-- - a scope: allow_list, with one folder entry per scoped folder carrying
--   the token's permissions (inserted below, once the table has its keys).
--   A folder entry covers the subtree, as the scope did, and folder entries
--   accept every permission, so nothing is lost.
-- Revoked and expired tokens are converted the same way; they stay unusable.
-- The old columns keep their values, so a server of the previous version
-- still reads the same access from them.
UPDATE "api_tokens" SET "access_mode" = CASE WHEN "folder_scope" IS NULL THEN 'deny_list' ELSE 'allow_list' END, "base_permissions" = CASE WHEN "folder_scope" IS NULL THEN "permissions" END;--> statement-breakpoint
ALTER TABLE "api_tokens" ALTER COLUMN "access_mode" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_id_access_mode_unique" UNIQUE("id","access_mode");--> statement-breakpoint
CREATE TABLE "api_token_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token_id" uuid NOT NULL,
	"token_access_mode" text NOT NULL,
	"target_kind" text NOT NULL,
	"folder_id" uuid,
	"note_id" uuid,
	"permissions" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_token_entries_token_id_folder_id_unique" UNIQUE("token_id","folder_id"),
	CONSTRAINT "api_token_entries_token_id_note_id_unique" UNIQUE("token_id","note_id"),
	CONSTRAINT "api_token_entries_target_kind_check" CHECK ("api_token_entries"."target_kind" in ('folder', 'note')),
	CONSTRAINT "api_token_entries_target_check" CHECK (("api_token_entries"."target_kind" = 'folder' and "api_token_entries"."folder_id" is not null and "api_token_entries"."note_id" is null) or ("api_token_entries"."target_kind" = 'note' and "api_token_entries"."note_id" is not null and "api_token_entries"."folder_id" is null)),
	CONSTRAINT "api_token_entries_permissions_check" CHECK (("api_token_entries"."token_access_mode" = 'deny_list' and "api_token_entries"."permissions" is null) or ("api_token_entries"."token_access_mode" = 'allow_list' and "api_token_entries"."permissions" is not null and cardinality("api_token_entries"."permissions") > 0 and array_ndims("api_token_entries"."permissions") = 1 and "api_token_entries"."permissions" <@ (case "api_token_entries"."target_kind" when 'folder' then ARRAY['read', 'search', 'create', 'edit', 'move', 'delete', 'lock']::text[] else ARRAY['read', 'edit', 'move', 'delete', 'lock']::text[] end)))
);--> statement-breakpoint
ALTER TABLE "api_token_entries" ADD CONSTRAINT "api_token_entries_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_token_entries" ADD CONSTRAINT "api_token_entries_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_token_entries" ADD CONSTRAINT "api_token_entries_token_fk" FOREIGN KEY ("token_id","token_access_mode") REFERENCES "public"."api_tokens"("id","access_mode") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_token_entries_folder_id_idx" ON "api_token_entries" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "api_token_entries_note_id_idx" ON "api_token_entries" USING btree ("note_id");--> statement-breakpoint
-- One folder entry per scoped folder. The scope had no foreign key: ids of
-- folders deleted for good since are skipped (the token could not reach
-- them any more either), and an id listed twice gives one entry. A scoped
-- folder in the trash gets its entry too, as trashed targets keep theirs. The
-- entry's created_at is the token's: the scope was set when the token was
-- created and could not be changed afterwards.
INSERT INTO "api_token_entries" ("token_id", "token_access_mode", "target_kind", "folder_id", "permissions", "created_at") SELECT DISTINCT "api_tokens"."id", 'allow_list', 'folder', "folders"."id", "api_tokens"."permissions", "api_tokens"."created_at" FROM "api_tokens" CROSS JOIN LATERAL unnest("api_tokens"."folder_scope") AS "scope"("folder_id") JOIN "folders" ON "folders"."id" = "scope"."folder_id" WHERE "api_tokens"."folder_scope" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_locked_by_user_id_users_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_locked_by_token_id_api_tokens_id_fk" FOREIGN KEY ("locked_by_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_access_mode_check" CHECK ("api_tokens"."access_mode" in ('allow_list', 'deny_list'));--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_base_permissions_check" CHECK (cardinality("api_tokens"."base_permissions") > 0 and array_ndims("api_tokens"."base_permissions") = 1 and "api_tokens"."base_permissions" <@ ARRAY['read', 'search', 'create', 'edit', 'move', 'delete', 'lock']::text[]);--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_base_permissions_mode_check" CHECK (("api_tokens"."access_mode" = 'deny_list') = ("api_tokens"."base_permissions" is not null));--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_locked_by_single_id_check" CHECK (num_nonnulls("folders"."locked_by_user_id", "folders"."locked_by_token_id") <= 1);--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_locked_by_name_length_check" CHECK (char_length("folders"."locked_by_name") between 1 and 64);--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_locked_by_pairing_check" CHECK (("folders"."locked_at" is null and "folders"."locked_by_user_id" is null and "folders"."locked_by_token_id" is null and "folders"."locked_by_name" is null) or ("folders"."locked_at" is not null and "folders"."locked_by_name" is not null));--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_lock_reason_check" CHECK ("folders"."lock_reason" is null or ("folders"."locked_at" is not null and char_length("folders"."lock_reason") between 1 and 500 and "folders"."lock_reason" ~ '[^[:space:]]'));--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_lock_reason_check" CHECK ("notes"."lock_reason" is null or ("notes"."locked_at" is not null and char_length("notes"."lock_reason") between 1 and 500 and "notes"."lock_reason" ~ '[^[:space:]]'));