CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"webauthn_challenge" text,
	"remember" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_challenges_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "auth_challenges_token_hash_format_check" CHECK ("auth_challenges"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_challenges_purpose_check" CHECK ("auth_challenges"."purpose" in ('second_factor', 'enrolment', 'setup_enrolment', 'webauthn_registration', 'webauthn_authentication')),
	CONSTRAINT "auth_challenges_webauthn_challenge_format_check" CHECK ("auth_challenges"."webauthn_challenge" ~ '^[A-Za-z0-9_-]{16,255}$'),
	CONSTRAINT "auth_challenges_webauthn_purpose_check" CHECK ("auth_challenges"."purpose" not in ('webauthn_registration', 'webauthn_authentication') or "auth_challenges"."webauthn_challenge" is not null),
	CONSTRAINT "auth_challenges_attempts_check" CHECK ("auth_challenges"."attempts" >= 0),
	CONSTRAINT "auth_challenges_expires_after_created_check" CHECK ("auth_challenges"."expires_at" > "auth_challenges"."created_at")
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_codes_user_id_code_hash_unique" UNIQUE("user_id","code_hash"),
	CONSTRAINT "recovery_codes_code_hash_format_check" CHECK ("recovery_codes"."code_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "totp_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret_encrypted" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_used_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "totp_credentials_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "totp_credentials_secret_encrypted_format_check" CHECK ("totp_credentials"."secret_encrypted" ~ '^v[0-9]+\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]+$'),
	CONSTRAINT "totp_credentials_last_used_step_check" CHECK ("totp_credentials"."last_used_step" >= 0)
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[],
	"name" text NOT NULL,
	"aaguid" text,
	"device_type" text,
	"backed_up" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "webauthn_credentials_credential_id_unique" UNIQUE("credential_id"),
	CONSTRAINT "webauthn_credentials_credential_id_format_check" CHECK ("webauthn_credentials"."credential_id" ~ '^[A-Za-z0-9_-]+$' and char_length("webauthn_credentials"."credential_id") <= 1364),
	CONSTRAINT "webauthn_credentials_name_length_check" CHECK (char_length("webauthn_credentials"."name") between 1 and 64),
	CONSTRAINT "webauthn_credentials_counter_check" CHECK ("webauthn_credentials"."counter" >= 0),
	CONSTRAINT "webauthn_credentials_device_type_check" CHECK ("webauthn_credentials"."device_type" in ('singleDevice', 'multiDevice'))
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "default_timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "require_two_factor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "reauthenticated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_credentials" ADD CONSTRAINT "totp_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_challenges_user_id_idx" ON "auth_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_challenges_expires_at_idx" ON "auth_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "webauthn_credentials_user_id_idx" ON "webauthn_credentials" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_default_timezone_check" CHECK ("instance_settings"."default_timezone" ~ '^[^[:space:]]{1,64}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_timezone_check" CHECK ("users"."timezone" ~ '^[^[:space:]]{1,64}$');