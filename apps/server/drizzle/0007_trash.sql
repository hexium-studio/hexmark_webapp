ALTER TABLE "folders" ADD COLUMN "deleted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "deleted_by_token_id" uuid;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "deleted_by_name" text;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "trash_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "deleted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "deleted_by_token_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "deleted_by_name" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "trash_batch_id" uuid;--> statement-breakpoint
-- Backfill for rows already in the trash, so the pairing checks below hold.
-- Before this migration the only way into the trash was deleting a note,
-- and that write set updated_by_* to whoever deleted it (and updated_at to
-- deleted_at), so updated_by_* is the deleting actor. Folders could not be
-- trashed (deleting one removed it for good); a folder with deleted_at set
-- was not written by Hexmark, and updated_by_* is the closest record left.
-- Each row gets a batch of its own: nothing recorded which rows were
-- trashed together, so they are restored one by one.
UPDATE "notes" SET "deleted_by_user_id" = "updated_by_user_id", "deleted_by_token_id" = "updated_by_token_id", "deleted_by_name" = "updated_by_name", "trash_batch_id" = gen_random_uuid() WHERE "deleted_at" is not null;--> statement-breakpoint
UPDATE "folders" SET "deleted_by_user_id" = "updated_by_user_id", "deleted_by_token_id" = "updated_by_token_id", "deleted_by_name" = "updated_by_name", "trash_batch_id" = gen_random_uuid() WHERE "deleted_at" is not null;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_deleted_by_token_id_api_tokens_id_fk" FOREIGN KEY ("deleted_by_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_deleted_by_token_id_api_tokens_id_fk" FOREIGN KEY ("deleted_by_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folders_deleted_at_idx" ON "folders" USING btree ("deleted_at") WHERE "folders"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "folders_trash_batch_id_idx" ON "folders" USING btree ("trash_batch_id") WHERE "folders"."trash_batch_id" is not null;--> statement-breakpoint
CREATE INDEX "notes_deleted_at_idx" ON "notes" USING btree ("deleted_at") WHERE "notes"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "notes_trash_batch_id_idx" ON "notes" USING btree ("trash_batch_id") WHERE "notes"."trash_batch_id" is not null;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_deleted_by_single_id_check" CHECK (num_nonnulls("folders"."deleted_by_user_id", "folders"."deleted_by_token_id") <= 1);--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_deleted_by_name_length_check" CHECK (char_length("folders"."deleted_by_name") between 1 and 64);--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_trash_pairing_check" CHECK (("folders"."deleted_at" is null and "folders"."deleted_by_user_id" is null and "folders"."deleted_by_token_id" is null and "folders"."deleted_by_name" is null and "folders"."trash_batch_id" is null) or ("folders"."deleted_at" is not null and "folders"."deleted_by_name" is not null and "folders"."trash_batch_id" is not null));--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_deleted_by_single_id_check" CHECK (num_nonnulls("notes"."deleted_by_user_id", "notes"."deleted_by_token_id") <= 1);--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_deleted_by_name_length_check" CHECK (char_length("notes"."deleted_by_name") between 1 and 64);--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_trash_pairing_check" CHECK (("notes"."deleted_at" is null and "notes"."deleted_by_user_id" is null and "notes"."deleted_by_token_id" is null and "notes"."deleted_by_name" is null and "notes"."trash_batch_id" is null) or ("notes"."deleted_at" is not null and "notes"."deleted_by_name" is not null and "notes"."trash_batch_id" is not null));