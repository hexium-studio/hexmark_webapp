-- New ids become UUID version 7 (PostgreSQL's built-in uuidv7(), added in
-- PostgreSQL 18). Older servers stop here with a clear message instead of
-- failing on the unknown function; the migrations run in one transaction, so
-- nothing of this run is kept.
DO $$ BEGIN IF current_setting('server_version_num')::int < 180000 THEN RAISE EXCEPTION 'Hexmark needs PostgreSQL 18 or newer, this server runs %', current_setting('server_version'); END IF; END $$;--> statement-breakpoint
-- Only the column defaults change; no row is rewritten. Existing rows keep
-- their version 4 ids on purpose: ids are referenced by foreign keys, by
-- links inside note bodies and by clients that stored them, and none of that
-- could be followed reliably. Both versions stay valid side by side, so an
-- id must never be parsed for a version, a time or an order.
ALTER TABLE "api_tokens" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "auth_challenges" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "folders" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "note_revisions" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "recovery_codes" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "totp_credentials" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ALTER COLUMN "id" SET DEFAULT uuidv7();