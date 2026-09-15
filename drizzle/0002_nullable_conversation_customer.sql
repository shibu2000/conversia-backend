ALTER TABLE "conversations" ALTER COLUMN "customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "visitor_label" text;