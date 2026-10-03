CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"previous_token_hash" text,
	"previous_valid_until" timestamp with time zone,
	"remember" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_token_hash_format_check" CHECK ("sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sessions_previous_token_hash_format_check" CHECK ("sessions"."previous_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sessions_previous_token_pair_check" CHECK (("sessions"."previous_token_hash" is null) = ("sessions"."previous_valid_until" is null)),
	CONSTRAINT "sessions_previous_token_differs_check" CHECK ("sessions"."previous_token_hash" <> "sessions"."token_hash"),
	CONSTRAINT "sessions_expires_after_created_check" CHECK ("sessions"."expires_at" > "sessions"."created_at"),
	CONSTRAINT "sessions_user_agent_length_check" CHECK (char_length("sessions"."user_agent") <= 256)
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_previous_token_hash_idx" ON "sessions" USING btree ("previous_token_hash") WHERE "sessions"."previous_token_hash" is not null;