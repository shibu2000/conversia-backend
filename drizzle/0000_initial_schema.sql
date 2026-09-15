-- Extensions the schema depends on. `pg_trgm` backs every fuzzy name-search
-- index below; without it those CREATE INDEX statements fail.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('customer', 'ai', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."ai_provider_status" AS ENUM('connected', 'disconnected', 'error', 'rate_limited');--> statement-breakpoint
CREATE TYPE "public"."analysis_status" AS ENUM('queued', 'crawling', 'analyzing', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."assignment_method" AS ENUM('manual', 'auto', 'round_robin', 'rule');--> statement-breakpoint
CREATE TYPE "public"."auth_token_purpose" AS ENUM('invite', 'password_reset', 'email_verify');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('requested', 'confirmed', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."chatbot_config_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."company_status" AS ENUM('active', 'trial', 'suspended', 'onboarding', 'archived');--> statement-breakpoint
CREATE TYPE "public"."conversation_channel" AS ENUM('web_widget', 'whatsapp', 'email', 'api', 'mobile_sdk');--> statement-breakpoint
CREATE TYPE "public"."conversation_intent" AS ENUM('faq', 'product_discovery', 'order_status', 'support_issue', 'lead_capture', 'booking', 'pricing', 'complaint', 'small_talk', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'waiting_on_customer', 'ai_resolved', 'human_handoff', 'escalated', 'closed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."customer_channel" AS ENUM('chatbot', 'website', 'email', 'manual', 'import', 'api');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('active', 'lead', 'customer', 'churned', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('sending', 'sent', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."faq_status" AS ENUM('published', 'draft', 'disabled', 'archived');--> statement-breakpoint
CREATE TYPE "public"."health_status" AS ENUM('operational', 'degraded', 'down', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."inventory_status" AS ENUM('in_stock', 'low_stock', 'out_of_stock', 'preorder', 'discontinued');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source_type" AS ENUM('pdf', 'docx', 'txt', 'website', 'manual', 'csv');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('ai_chatbot', 'website', 'manual', 'import', 'api');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'proposal', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('customer', 'assistant', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('assignment', 'conversation', 'ticket', 'lead', 'knowledge', 'chatbot', 'system', 'billing');--> statement-breakpoint
CREATE TYPE "public"."notification_severity" AS ENUM('info', 'success', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('starter', 'growth', 'scale', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('super_admin', 'platform_support', 'company_user');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('pending', 'processing', 'ready', 'failed', 'outdated');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('active', 'draft', 'archived');--> statement-breakpoint
CREATE TYPE "public"."role_slug" AS ENUM('company_admin', 'manager', 'sales', 'support', 'viewer', 'custom');--> statement-breakpoint
CREATE TYPE "public"."suggestion_kind" AS ENUM('company_info', 'product', 'policy', 'faq', 'contact');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('pending', 'accepted', 'rejected', 'edited');--> statement-breakpoint
CREATE TYPE "public"."ticket_category" AS ENUM('order_issue', 'delivery', 'returns', 'refund', 'product_defect', 'billing', 'account', 'technical', 'other');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'assigned', 'in_progress', 'waiting', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."ticket_timeline_kind" AS ENUM('customer_message', 'ai_response', 'agent_reply', 'internal_note', 'created', 'assigned', 'status_changed', 'priority_changed', 'category_changed', 'escalated', 'resolved', 'reopened', 'attachment_added');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'invited', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."wizard_step_status" AS ENUM('not_started', 'in_progress', 'complete', 'skipped');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"website" text DEFAULT '' NOT NULL,
	"industry" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"status" "company_status" DEFAULT 'onboarding' NOT NULL,
	"plan" "plan_tier" DEFAULT 'starter' NOT NULL,
	"primary_contact_name" text DEFAULT '' NOT NULL,
	"primary_contact_email" text DEFAULT '' NOT NULL,
	"onboarding_progress" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "company_daily_stats" (
	"company_id" text NOT NULL,
	"day" timestamp with time zone NOT NULL,
	"conversations" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"tickets" integer DEFAULT 0 NOT NULL,
	"ai_requests" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"company_id" text PRIMARY KEY NOT NULL,
	"business_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"support_email" text DEFAULT '' NOT NULL,
	"default_lead_owner_id" text,
	"default_ticket_team_id" text,
	"data_retention_days" integer DEFAULT 730 NOT NULL,
	"locales" text[] DEFAULT ARRAY['en-US']::text[] NOT NULL,
	"default_locale" text DEFAULT 'en-US' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_usage" (
	"company_id" text PRIMARY KEY NOT NULL,
	"ai_requests" integer DEFAULT 0 NOT NULL,
	"ai_request_quota" integer DEFAULT 5000 NOT NULL,
	"conversations" integer DEFAULT 0 NOT NULL,
	"conversation_quota" integer DEFAULT 1000 NOT NULL,
	"knowledge_documents" integer DEFAULT 0 NOT NULL,
	"knowledge_document_quota" integer DEFAULT 50 NOT NULL,
	"seats" integer DEFAULT 0 NOT NULL,
	"seat_quota" integer DEFAULT 5 NOT NULL,
	"tokens_in" bigint DEFAULT 0 NOT NULL,
	"tokens_out" bigint DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(12, 2) DEFAULT '0' NOT NULL,
	"period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"period_end" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"rotated_to" text,
	"user_agent" text,
	"ip_address" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"purpose" "auth_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"slug" "role_slug" NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_id_company_key" UNIQUE("id","company_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"avatar_url" text,
	"platform_role" "platform_role" DEFAULT 'company_user' NOT NULL,
	"role_id" text,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"title" text,
	"phone" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"last_active_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_id_company_key" UNIQUE("id","company_id")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"reference" text NOT NULL,
	"type" text DEFAULT '' NOT NULL,
	"status" "booking_status" DEFAULT 'requested' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"assigned_user_id" text,
	"location" text DEFAULT '' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"avatar_url" text,
	"company_name" text,
	"country" text DEFAULT '' NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"status" "customer_status" DEFAULT 'lead' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_seen_channel" "customer_channel" DEFAULT 'manual' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifetime_value_usd" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"reference" text NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"total_usd" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" text,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"short_description" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" text,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"price_usd" numeric(12, 2) DEFAULT '0' NOT NULL,
	"compare_at_price_usd" numeric(12, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"inventory_status" "inventory_status" DEFAULT 'out_of_stock' NOT NULL,
	"stock_qty" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 10 NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attributes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rating" numeric(3, 2),
	"review_count" integer DEFAULT 0 NOT NULL,
	"url" text,
	"ai_keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"ai_use_cases" text[] DEFAULT '{}'::text[] NOT NULL,
	"ai_audience" text[] DEFAULT '{}'::text[] NOT NULL,
	"ai_talking_points" text[] DEFAULT '{}'::text[] NOT NULL,
	"ai_include_in_recommendations" boolean DEFAULT false NOT NULL,
	"lead_count" integer DEFAULT 0 NOT NULL,
	"conversation_mentions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_products" (
	"conversation_id" text NOT NULL,
	"product_id" text NOT NULL,
	CONSTRAINT "conversation_products_conversation_id_product_id_pk" PRIMARY KEY("conversation_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"reference" text NOT NULL,
	"customer_id" text NOT NULL,
	"channel" "conversation_channel" DEFAULT 'web_widget' NOT NULL,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"intent" "conversation_intent" DEFAULT 'unknown' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"preview" text DEFAULT '' NOT NULL,
	"assigned_user_id" text,
	"lead_id" text,
	"ticket_id" text,
	"message_count" integer DEFAULT 0 NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"resolved_by_ai" boolean DEFAULT false NOT NULL,
	"ai_confidence" numeric(4, 3) DEFAULT '0' NOT NULL,
	"csat_score" integer,
	"first_response_seconds" integer,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"company_id" text NOT NULL,
	"role" "message_role" NOT NULL,
	"author_id" text,
	"author_name" text,
	"body" text DEFAULT '' NOT NULL,
	"event" jsonb,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quick_replies" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"delivery_status" "delivery_status",
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_assignment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"company_id" text NOT NULL,
	"from_user_id" text,
	"from_user_name" text,
	"to_user_id" text,
	"to_user_name" text,
	"by_user_id" text,
	"by_user_name" text NOT NULL,
	"method" "assignment_method" DEFAULT 'manual' NOT NULL,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"company_id" text NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_products" (
	"lead_id" text NOT NULL,
	"product_id" text NOT NULL,
	CONSTRAINT "lead_products_lead_id_product_id_pk" PRIMARY KEY("lead_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"reference" text NOT NULL,
	"customer_id" text NOT NULL,
	"interest" text DEFAULT '' NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"source" "lead_source" DEFAULT 'manual' NOT NULL,
	"assigned_user_id" text,
	"conversation_id" text,
	"estimated_value_usd" numeric(12, 2),
	"score" integer DEFAULT 50 NOT NULL,
	"qualification_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_follow_up_at" timestamp with time zone,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"lost_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_assignment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"company_id" text NOT NULL,
	"from_user_id" text,
	"from_user_name" text,
	"to_user_id" text,
	"to_user_name" text,
	"by_user_id" text,
	"by_user_name" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_timeline_events" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"company_id" text NOT NULL,
	"kind" "ticket_timeline_kind" NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"meta" jsonb,
	"is_internal" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"reference" text NOT NULL,
	"subject" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"customer_id" text NOT NULL,
	"category" "ticket_category" DEFAULT 'other' NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"assigned_user_id" text,
	"team_id" text,
	"conversation_id" text,
	"order_id" text,
	"order_reference" text,
	"created_by_ai" boolean DEFAULT false NOT NULL,
	"sla_due_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"reopen_count" integer DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"csat_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faq_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"set_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"status" "faq_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faq_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "faq_status" DEFAULT 'draft' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"match_count_30d" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faqs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"set_id" text NOT NULL,
	"category_id" text NOT NULL,
	"question" text NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "faq_status" DEFAULT 'draft' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"match_count_30d" integer DEFAULT 0 NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"not_helpful_count" integer DEFAULT 0 NOT NULL,
	"last_matched_at" timestamp with time zone,
	"ai_suggested" boolean DEFAULT false NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, coalesce(question, '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce(answer, '')), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"document_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"text" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"locator" text DEFAULT '' NOT NULL,
	"embedding_status" "processing_status" DEFAULT 'pending' NOT NULL,
	"retrieval_count_30d" integer DEFAULT 0 NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig, coalesce(text, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"available_to_chatbot" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text DEFAULT 'text/plain' NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"page_count" integer,
	"status" "processing_status" DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"embedding_status" "processing_status" DEFAULT 'pending' NOT NULL,
	"embedding_model" text DEFAULT '' NOT NULL,
	"vector_count" integer DEFAULT 0 NOT NULL,
	"index_status" "processing_status" DEFAULT 'pending' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"extracted_text" text DEFAULT '' NOT NULL,
	"url" text,
	"error_message" text,
	"pipeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retrieval_count_30d" integer DEFAULT 0 NOT NULL,
	"storage_key" text,
	"checksum" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"collection_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "knowledge_source_type" NOT NULL,
	"status" "processing_status" DEFAULT 'pending' NOT NULL,
	"origin" text DEFAULT '' NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"last_indexed_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"crawl" jsonb,
	"added_by_id" text,
	"added_by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatbot_config_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"published_by_id" text,
	"published_by_name" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatbot_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"status" "chatbot_config_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_id" text,
	"published_by_name" text,
	"has_unpublished_changes" boolean DEFAULT true NOT NULL,
	"identity" jsonb NOT NULL,
	"appearance" jsonb NOT NULL,
	"behavior" jsonb NOT NULL,
	"ai" jsonb NOT NULL,
	"knowledge" jsonb NOT NULL,
	"leads" jsonb NOT NULL,
	"tickets" jsonb NOT NULL,
	"handoff" jsonb NOT NULL,
	"published_config" jsonb,
	"embed_key" text NOT NULL,
	"allowed_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"verified_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_ping_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatbot_configs_company_id_unique" UNIQUE("company_id"),
	CONSTRAINT "chatbot_configs_embed_key_unique" UNIQUE("embed_key")
);
--> statement-breakpoint
CREATE TABLE "website_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"url" text NOT NULL,
	"status" "analysis_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"pages_crawled" integer DEFAULT 0 NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "website_analysis_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"analysis_id" text NOT NULL,
	"company_id" text NOT NULL,
	"kind" "suggestion_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"source_url" text DEFAULT '' NOT NULL,
	"confidence" numeric(4, 3) DEFAULT '0' NOT NULL,
	"status" "suggestion_status" DEFAULT 'pending' NOT NULL,
	"edited_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizard_states" (
	"company_id" text PRIMARY KEY NOT NULL,
	"current_step_key" text DEFAULT 'company' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"vendor" text NOT NULL,
	"status" "ai_provider_status" DEFAULT 'disconnected' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"monthly_requests" bigint DEFAULT 0 NOT NULL,
	"monthly_spend_usd" numeric(12, 2) DEFAULT '0' NOT NULL,
	"last_error_at" timestamp with time zone,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"user_id" text NOT NULL,
	"category" "notification_category" NOT NULL,
	"severity" "notification_severity" DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"href" text,
	"actor_name" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_health_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "health_status" DEFAULT 'operational' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"uptime_pct" numeric(6, 3) DEFAULT '100' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_daily_stats" ADD CONSTRAINT "company_daily_stats_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_usage" ADD CONSTRAINT "company_usage_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_products" ADD CONSTRAINT "conversation_products_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_products" ADD CONSTRAINT "conversation_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignee_same_company" FOREIGN KEY ("assigned_user_id","company_id") REFERENCES "public"."users"("id","company_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignment_events" ADD CONSTRAINT "lead_assignment_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignment_events" ADD CONSTRAINT "lead_assignment_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignment_events" ADD CONSTRAINT "lead_assignment_events_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignment_events" ADD CONSTRAINT "lead_assignment_events_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignment_events" ADD CONSTRAINT "lead_assignment_events_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_products" ADD CONSTRAINT "lead_products_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_products" ADD CONSTRAINT "lead_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignee_same_company" FOREIGN KEY ("assigned_user_id","company_id") REFERENCES "public"."users"("id","company_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_assignment_events" ADD CONSTRAINT "ticket_assignment_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_assignment_events" ADD CONSTRAINT "ticket_assignment_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_assignment_events" ADD CONSTRAINT "ticket_assignment_events_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_assignment_events" ADD CONSTRAINT "ticket_assignment_events_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_assignment_events" ADD CONSTRAINT "ticket_assignment_events_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_timeline_events" ADD CONSTRAINT "ticket_timeline_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_timeline_events" ADD CONSTRAINT "ticket_timeline_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_timeline_events" ADD CONSTRAINT "ticket_timeline_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_same_company" FOREIGN KEY ("assigned_user_id","company_id") REFERENCES "public"."users"("id","company_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_team_same_company" FOREIGN KEY ("team_id","company_id") REFERENCES "public"."teams"("id","company_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq_categories" ADD CONSTRAINT "faq_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq_categories" ADD CONSTRAINT "faq_categories_set_id_faq_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."faq_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq_sets" ADD CONSTRAINT "faq_sets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_set_id_faq_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."faq_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_category_id_faq_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."faq_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_collections" ADD CONSTRAINT "knowledge_collections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_collection_id_knowledge_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."knowledge_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatbot_config_versions" ADD CONSTRAINT "chatbot_config_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatbot_config_versions" ADD CONSTRAINT "chatbot_config_versions_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatbot_configs" ADD CONSTRAINT "chatbot_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatbot_configs" ADD CONSTRAINT "chatbot_configs_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analyses" ADD CONSTRAINT "website_analyses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analysis_suggestions" ADD CONSTRAINT "website_analysis_suggestions_analysis_id_website_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."website_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analysis_suggestions" ADD CONSTRAINT "website_analysis_suggestions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizard_states" ADD CONSTRAINT "wizard_states_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_status_idx" ON "companies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "companies_plan_idx" ON "companies" USING btree ("plan");--> statement-breakpoint
CREATE INDEX "companies_name_trgm_idx" ON "companies" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "company_daily_stats_pk" ON "company_daily_stats" USING btree ("company_id","day");--> statement-breakpoint
CREATE INDEX "activity_company_at_idx" ON "activity_events" USING btree ("company_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_actor_at_idx" ON "activity_events" USING btree ("actor_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_target_idx" ON "activity_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expiry_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_purpose_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "roles_company_idx" ON "roles" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_company_slug_idx" ON "roles" USING btree ("company_id","slug") WHERE is_system;--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "teams_company_idx" ON "teams" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_company_email_idx" ON "users" USING btree ("company_id",lower("email")) WHERE company_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_platform_email_idx" ON "users" USING btree (lower("email")) WHERE company_id IS NULL;--> statement-breakpoint
CREATE INDEX "users_company_idx" ON "users" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "users_name_trgm_idx" ON "users" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_company_reference_idx" ON "bookings" USING btree ("company_id","reference");--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_id","scheduled_for" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "customers_company_idx" ON "customers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "customers_company_status_idx" ON "customers" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "customers_name_trgm_idx" ON "customers" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("company_id",lower("email"));--> statement-breakpoint
CREATE INDEX "customers_tags_idx" ON "customers" USING gin ("tags");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_company_reference_idx" ON "orders" USING btree ("company_id","reference");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "product_categories_company_slug_idx" ON "product_categories" USING btree ("company_id","slug");--> statement-breakpoint
CREATE INDEX "product_categories_company_idx" ON "product_categories" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_company_sku_idx" ON "products" USING btree ("company_id",lower("sku"));--> statement-breakpoint
CREATE INDEX "products_company_idx" ON "products" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "products_company_status_idx" ON "products" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_ai_keywords_idx" ON "products" USING gin ("ai_keywords");--> statement-breakpoint
CREATE INDEX "conversation_products_product_idx" ON "conversation_products" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_company_reference_idx" ON "conversations" USING btree ("company_id","reference");--> statement-breakpoint
CREATE INDEX "conversations_company_last_message_idx" ON "conversations" USING btree ("company_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_company_status_idx" ON "conversations" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "conversations_assignee_idx" ON "conversations" USING btree ("company_id","assigned_user_id");--> statement-breakpoint
CREATE INDEX "conversations_customer_idx" ON "conversations" USING btree ("customer_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_subject_trgm_idx" ON "conversations" USING gin ("subject" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "messages_conversation_at_idx" ON "messages" USING btree ("conversation_id","at");--> statement-breakpoint
CREATE INDEX "messages_company_idx" ON "messages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "lead_assignment_events_lead_idx" ON "lead_assignment_events" USING btree ("lead_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lead_notes_lead_idx" ON "lead_notes" USING btree ("lead_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lead_products_product_idx" ON "lead_products" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_company_reference_idx" ON "leads" USING btree ("company_id","reference");--> statement-breakpoint
CREATE INDEX "leads_company_created_idx" ON "leads" USING btree ("company_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_company_status_idx" ON "leads" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "leads_assignee_idx" ON "leads" USING btree ("company_id","assigned_user_id");--> statement-breakpoint
CREATE INDEX "leads_follow_up_idx" ON "leads" USING btree ("company_id","next_follow_up_at") WHERE next_follow_up_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "leads_interest_trgm_idx" ON "leads" USING gin ("interest" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ticket_assignment_ticket_idx" ON "ticket_assignment_events" USING btree ("ticket_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ticket_timeline_ticket_idx" ON "ticket_timeline_events" USING btree ("ticket_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_company_reference_idx" ON "tickets" USING btree ("company_id","reference");--> statement-breakpoint
CREATE INDEX "tickets_company_created_idx" ON "tickets" USING btree ("company_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_company_status_idx" ON "tickets" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "tickets_assignee_idx" ON "tickets" USING btree ("company_id","assigned_user_id");--> statement-breakpoint
CREATE INDEX "tickets_team_idx" ON "tickets" USING btree ("company_id","team_id");--> statement-breakpoint
CREATE INDEX "tickets_sla_idx" ON "tickets" USING btree ("company_id","sla_due_at") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX "tickets_subject_trgm_idx" ON "tickets" USING gin ("subject" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "faq_categories_set_idx" ON "faq_categories" USING btree ("set_id","parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "faq_categories_company_idx" ON "faq_categories" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "faq_sets_company_slug_idx" ON "faq_sets" USING btree ("company_id","slug");--> statement-breakpoint
CREATE INDEX "faq_sets_company_idx" ON "faq_sets" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "faq_sets_one_default_idx" ON "faq_sets" USING btree ("company_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "faqs_set_idx" ON "faqs" USING btree ("set_id","category_id","sort_order");--> statement-breakpoint
CREATE INDEX "faqs_company_idx" ON "faqs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "faqs_status_idx" ON "faqs" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "faqs_keywords_idx" ON "faqs" USING gin ("keywords");--> statement-breakpoint
CREATE INDEX "faqs_search_idx" ON "faqs" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_document_index_idx" ON "knowledge_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_company_idx" ON "knowledge_chunks" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_search_idx" ON "knowledge_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "knowledge_collections_company_idx" ON "knowledge_collections" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "knowledge_documents_company_idx" ON "knowledge_documents" USING btree ("company_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "knowledge_documents_source_idx" ON "knowledge_documents" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "knowledge_documents_status_idx" ON "knowledge_documents" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_documents_name_trgm_idx" ON "knowledge_documents" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "knowledge_sources_company_idx" ON "knowledge_sources" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "knowledge_sources_collection_idx" ON "knowledge_sources" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "knowledge_sources_status_idx" ON "knowledge_sources" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_sources_name_trgm_idx" ON "knowledge_sources" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "chatbot_config_versions_idx" ON "chatbot_config_versions" USING btree ("company_id","version");--> statement-breakpoint
CREATE INDEX "chatbot_configs_embed_key_idx" ON "chatbot_configs" USING btree ("embed_key");--> statement-breakpoint
CREATE INDEX "website_analyses_company_idx" ON "website_analyses" USING btree ("company_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "website_analysis_suggestions_analysis_idx" ON "website_analysis_suggestions" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "notifications_user_at_idx" ON "notifications" USING btree ("user_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE NOT read;