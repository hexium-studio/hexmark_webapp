CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"actor_token_id" uuid,
	"actor_name" text NOT NULL,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"error_code" text,
	"target_kind" text,
	"target_id" uuid,
	"target_label" text,
	"reason" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_events_actor_single_id_check" CHECK (num_nonnulls("audit_events"."actor_user_id", "audit_events"."actor_token_id") <= 1),
	CONSTRAINT "audit_events_actor_name_length_check" CHECK (char_length("audit_events"."actor_name") between 1 and 64),
	CONSTRAINT "audit_events_actor_kind_check" CHECK ("audit_events"."actor_kind" in ('human', 'agent', 'system')),
	CONSTRAINT "audit_events_actor_kind_ids_check" CHECK (("audit_events"."actor_kind" = 'human' and "audit_events"."actor_token_id" is null) or ("audit_events"."actor_kind" = 'agent' and "audit_events"."actor_user_id" is null) or ("audit_events"."actor_kind" = 'system' and "audit_events"."actor_user_id" is null and "audit_events"."actor_token_id" is null and "audit_events"."actor_name" = 'System')),
	CONSTRAINT "audit_events_source_check" CHECK ("audit_events"."source" in ('web', 'http', 'mcp', 'system')),
	CONSTRAINT "audit_events_action_format_check" CHECK (char_length("audit_events"."action") <= 64 and "audit_events"."action" ~ '^[a-z_]+(\.[a-z_]+)+$'),
	CONSTRAINT "audit_events_outcome_check" CHECK ("audit_events"."outcome" in ('success', 'failure')),
	CONSTRAINT "audit_events_error_code_check" CHECK (("audit_events"."outcome" = 'success' and "audit_events"."error_code" is null) or ("audit_events"."outcome" = 'failure' and "audit_events"."error_code" is not null and char_length("audit_events"."error_code") <= 64 and "audit_events"."error_code" ~ '^[a-z][a-z0-9_]*$')),
	CONSTRAINT "audit_events_target_kind_format_check" CHECK (char_length("audit_events"."target_kind") <= 32 and "audit_events"."target_kind" ~ '^[a-z][a-z_]*$'),
	CONSTRAINT "audit_events_target_pairing_check" CHECK ("audit_events"."target_kind" is not null or ("audit_events"."target_id" is null and "audit_events"."target_label" is null)),
	CONSTRAINT "audit_events_target_label_length_check" CHECK (char_length("audit_events"."target_label") between 1 and 1000),
	CONSTRAINT "audit_events_reason_length_check" CHECK (char_length("audit_events"."reason") <= 500),
	CONSTRAINT "audit_events_details_object_check" CHECK (jsonb_typeof("audit_events"."details") = 'object'),
	CONSTRAINT "audit_events_details_size_check" CHECK (pg_column_size("audit_events"."details") <= 16384)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_token_id_api_tokens_id_fk" FOREIGN KEY ("actor_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_events_actor_name_idx" ON "audit_events" USING btree ("actor_name","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_events_actor_user_id_idx" ON "audit_events" USING btree ("actor_user_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_events_actor_token_id_idx" ON "audit_events" USING btree ("actor_token_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_events_failure_idx" ON "audit_events" USING btree ("outcome","occurred_at" DESC NULLS FIRST) WHERE "audit_events"."outcome" = 'failure';--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_kind","target_id");--> statement-breakpoint
-- The audit log is append-only. These triggers guard against mistakes in the
-- application; they are no boundary against the database owner, who can
-- disable them.
--
-- UPDATE is refused, with one exception: deleting a user or an API token sets
-- actor_user_id or actor_token_id to null through the foreign key action
-- (ON DELETE SET NULL), which PostgreSQL carries out as an UPDATE from inside
-- its own trigger. That is allowed when it runs nested in another trigger and
-- changes nothing but those ids to null; actor_name keeps the name.
CREATE FUNCTION "audit_events_refuse_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1
    AND (NEW."actor_user_id" IS NULL OR NEW."actor_user_id" = OLD."actor_user_id")
    AND (NEW."actor_token_id" IS NULL OR NEW."actor_token_id" = OLD."actor_token_id")
    AND to_jsonb(NEW) - 'actor_user_id' - 'actor_token_id' = to_jsonb(OLD) - 'actor_user_id' - 'actor_token_id'
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only: rows cannot be changed' USING ERRCODE = 'restrict_violation';
END $$;--> statement-breakpoint
-- DELETE and TRUNCATE only for the retention purge, which runs
-- `set local hexmark.audit_purge = 'on'` in its transaction first. The
-- setting ends with that transaction.
CREATE FUNCTION "audit_events_refuse_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('hexmark.audit_purge', true), '') = 'on' THEN
    RETURN CASE WHEN TG_LEVEL = 'ROW' THEN OLD ELSE NULL END;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only: rows are removed only by the retention purge (set local hexmark.audit_purge = ''on'')' USING ERRCODE = 'restrict_violation';
END $$;--> statement-breakpoint
CREATE TRIGGER "audit_events_refuse_update" BEFORE UPDATE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION "audit_events_refuse_update"();--> statement-breakpoint
CREATE TRIGGER "audit_events_refuse_delete" BEFORE DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION "audit_events_refuse_delete"();--> statement-breakpoint
CREATE TRIGGER "audit_events_refuse_truncate" BEFORE TRUNCATE ON "audit_events" FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_refuse_delete"();
