CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"permissions" text[] NOT NULL,
	"folder_scope" uuid[],
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_tokens_name_length_check" CHECK (char_length("api_tokens"."name") between 1 and 64),
	CONSTRAINT "api_tokens_token_hash_format_check" CHECK ("api_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_tokens_token_prefix_format_check" CHECK ("api_tokens"."token_prefix" ~ '^hmk_[A-Za-z0-9_-]{4}$'),
	CONSTRAINT "api_tokens_permissions_check" CHECK (cardinality("api_tokens"."permissions") > 0 and array_ndims("api_tokens"."permissions") = 1 and "api_tokens"."permissions" <@ ARRAY['read', 'search', 'create', 'edit', 'move', 'delete', 'lock']::text[]),
	CONSTRAINT "api_tokens_folder_scope_check" CHECK (cardinality("api_tokens"."folder_scope") > 0 and array_ndims("api_tokens"."folder_scope") = 1 and array_position("api_tokens"."folder_scope", null) is null),
	CONSTRAINT "api_tokens_expires_after_created_check" CHECK ("api_tokens"."expires_at" > "api_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"created_by_token_id" uuid,
	"created_by_name" text NOT NULL,
	"updated_by_user_id" uuid,
	"updated_by_token_id" uuid,
	"updated_by_name" text NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "folders_name_check" CHECK (char_length("folders"."name") between 1 and 120 and strpos("folders"."name", '/') = 0 and "folders"."name" !~ '^[[:space:]]|[[:space:]]$'),
	CONSTRAINT "folders_not_own_parent_check" CHECK ("folders"."parent_id" <> "folders"."id"),
	CONSTRAINT "folders_created_by_single_id_check" CHECK (num_nonnulls("folders"."created_by_user_id", "folders"."created_by_token_id") <= 1),
	CONSTRAINT "folders_created_by_name_length_check" CHECK (char_length("folders"."created_by_name") between 1 and 64),
	CONSTRAINT "folders_updated_by_single_id_check" CHECK (num_nonnulls("folders"."updated_by_user_id", "folders"."updated_by_token_id") <= 1),
	CONSTRAINT "folders_updated_by_name_length_check" CHECK (char_length("folders"."updated_by_name") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "note_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"folder_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"change" text NOT NULL,
	"reason" text,
	"actor_user_id" uuid,
	"actor_token_id" uuid,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_revisions_note_id_version_unique" UNIQUE("note_id","version"),
	CONSTRAINT "note_revisions_version_check" CHECK ("note_revisions"."version" >= 1),
	CONSTRAINT "note_revisions_title_length_check" CHECK (char_length("note_revisions"."title") between 1 and 200),
	CONSTRAINT "note_revisions_body_size_check" CHECK (octet_length("note_revisions"."body") <= 1048576),
	CONSTRAINT "note_revisions_metadata_object_check" CHECK (jsonb_typeof("note_revisions"."metadata") = 'object'),
	CONSTRAINT "note_revisions_change_check" CHECK ("note_revisions"."change" in ('created', 'edited', 'renamed', 'moved', 'deleted', 'restored')),
	CONSTRAINT "note_revisions_reason_length_check" CHECK (char_length("note_revisions"."reason") <= 500),
	CONSTRAINT "note_revisions_actor_single_id_check" CHECK (num_nonnulls("note_revisions"."actor_user_id", "note_revisions"."actor_token_id") <= 1),
	CONSTRAINT "note_revisions_actor_name_length_check" CHECK (char_length("note_revisions"."actor_name") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "note_sections" (
	"note_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"level" smallint NOT NULL,
	"heading" text NOT NULL,
	"path" text NOT NULL,
	"parent_position" integer,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"subtree_end_offset" integer NOT NULL,
	"characters" integer NOT NULL,
	"approx_tokens" integer NOT NULL,
	"search" "tsvector" NOT NULL,
	CONSTRAINT "note_sections_pkey" PRIMARY KEY("note_id","position"),
	CONSTRAINT "note_sections_position_check" CHECK ("note_sections"."position" >= 0),
	CONSTRAINT "note_sections_level_check" CHECK ("note_sections"."level" between 0 and 6),
	CONSTRAINT "note_sections_path_check" CHECK (char_length("note_sections"."path") > 0),
	CONSTRAINT "note_sections_parent_position_check" CHECK ("note_sections"."parent_position" >= 0 and "note_sections"."parent_position" < "note_sections"."position"),
	CONSTRAINT "note_sections_offsets_check" CHECK (0 <= "note_sections"."start_offset" and "note_sections"."start_offset" <= "note_sections"."end_offset" and "note_sections"."end_offset" <= "note_sections"."subtree_end_offset"),
	CONSTRAINT "note_sections_size_check" CHECK ("note_sections"."characters" >= 0 and "note_sections"."approx_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', "title"), 'A') || setweight(to_tsvector('simple', "body"), 'B')) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"created_by_token_id" uuid,
	"created_by_name" text NOT NULL,
	"updated_by_user_id" uuid,
	"updated_by_token_id" uuid,
	"updated_by_name" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"locked_by_user_id" uuid,
	"locked_by_token_id" uuid,
	"locked_by_name" text,
	"hidden" boolean DEFAULT false NOT NULL,
	CONSTRAINT "notes_title_length_check" CHECK (char_length("notes"."title") between 1 and 200),
	CONSTRAINT "notes_body_size_check" CHECK (octet_length("notes"."body") <= 1048576),
	CONSTRAINT "notes_metadata_object_check" CHECK (jsonb_typeof("notes"."metadata") = 'object'),
	CONSTRAINT "notes_version_check" CHECK ("notes"."version" >= 1),
	CONSTRAINT "notes_created_by_single_id_check" CHECK (num_nonnulls("notes"."created_by_user_id", "notes"."created_by_token_id") <= 1),
	CONSTRAINT "notes_created_by_name_length_check" CHECK (char_length("notes"."created_by_name") between 1 and 64),
	CONSTRAINT "notes_updated_by_single_id_check" CHECK (num_nonnulls("notes"."updated_by_user_id", "notes"."updated_by_token_id") <= 1),
	CONSTRAINT "notes_updated_by_name_length_check" CHECK (char_length("notes"."updated_by_name") between 1 and 64),
	CONSTRAINT "notes_locked_by_single_id_check" CHECK (num_nonnulls("notes"."locked_by_user_id", "notes"."locked_by_token_id") <= 1),
	CONSTRAINT "notes_locked_by_name_length_check" CHECK (char_length("notes"."locked_by_name") between 1 and 64),
	CONSTRAINT "notes_locked_by_pairing_check" CHECK (("notes"."locked_at" is null and "notes"."locked_by_user_id" is null and "notes"."locked_by_token_id" is null and "notes"."locked_by_name" is null) or ("notes"."locked_at" is not null and "notes"."locked_by_name" is not null))
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_created_by_token_id_api_tokens_id_fk" FOREIGN KEY ("created_by_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_updated_by_token_id_api_tokens_id_fk" FOREIGN KEY ("updated_by_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_actor_token_id_api_tokens_id_fk" FOREIGN KEY ("actor_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_sections" ADD CONSTRAINT "note_sections_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_token_id_api_tokens_id_fk" FOREIGN KEY ("created_by_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_updated_by_token_id_api_tokens_id_fk" FOREIGN KEY ("updated_by_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_locked_by_user_id_users_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_locked_by_token_id_api_tokens_id_fk" FOREIGN KEY ("locked_by_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_user_id_name_unique" ON "api_tokens" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "folders_parent_id_name_unique" ON "folders" USING btree ("parent_id",lower("name")) WHERE "folders"."parent_id" is not null and "folders"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_root_name_unique" ON "folders" USING btree (lower("name")) WHERE "folders"."parent_id" is null and "folders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "note_sections_search_idx" ON "note_sections" USING gin ("search");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_folder_id_title_unique" ON "notes" USING btree ("folder_id",lower("title")) WHERE "notes"."folder_id" is not null and "notes"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notes_root_title_unique" ON "notes" USING btree (lower("title")) WHERE "notes"."folder_id" is null and "notes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "notes_search_idx" ON "notes" USING gin ("search");--> statement-breakpoint
CREATE INDEX "notes_updated_at_idx" ON "notes" USING btree ("updated_at");