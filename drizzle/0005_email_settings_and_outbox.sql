CREATE TYPE "public"."email_outbox_status" AS ENUM('pending', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"to_email" text NOT NULL,
	"to_name" text DEFAULT '' NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"status" "email_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "email_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "smtp_host" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "smtp_port" integer DEFAULT 587 NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "smtp_secure" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "smtp_user" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "smtp_password_encrypted" text;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "smtp_from_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "smtp_from_email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "lead_notification_email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_claim_idx" ON "email_outbox" USING btree ("status","send_after");--> statement-breakpoint
CREATE INDEX "email_outbox_company_idx" ON "email_outbox" USING btree ("company_id","created_at" DESC NULLS LAST);