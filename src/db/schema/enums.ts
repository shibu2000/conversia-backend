import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Enumerations shared by the schema.
 *
 * These mirror the union types in the frontend's `src/types` exactly. Declaring
 * them as real Postgres enums rather than free text means a bad value is
 * rejected by the database, not just by whichever code path remembered to check.
 */
export const companyStatusEnum = pgEnum("company_status", ["active", "trial", "suspended", "onboarding", "archived"]);
export const planTierEnum = pgEnum("plan_tier", ["starter", "growth", "scale", "enterprise"]);

export const platformRoleEnum = pgEnum("platform_role", ["super_admin", "platform_support", "company_user"]);
export const userStatusEnum = pgEnum("user_status", ["active", "invited", "disabled"]);
export const roleSlugEnum = pgEnum("role_slug", ["company_admin", "manager", "sales", "support", "viewer", "custom"]);
export const authTokenPurposeEnum = pgEnum("auth_token_purpose", ["invite", "password_reset", "email_verify"]);

export const customerStatusEnum = pgEnum("customer_status", ["active", "lead", "customer", "churned", "blocked"]);
export const customerChannelEnum = pgEnum("customer_channel", ["chatbot", "website", "email", "manual", "import", "api"]);

export const productStatusEnum = pgEnum("product_status", ["active", "draft", "archived"]);
export const inventoryStatusEnum = pgEnum("inventory_status", ["in_stock", "low_stock", "out_of_stock", "preorder", "discontinued"]);
export const orderStatusEnum = pgEnum("order_status", ["pending", "paid", "shipped", "delivered", "cancelled", "refunded"]);
export const bookingStatusEnum = pgEnum("booking_status", ["requested", "confirmed", "completed", "cancelled", "no_show"]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "waiting_on_customer",
  "ai_resolved",
  "human_handoff",
  "escalated",
  "closed",
  "abandoned",
]);
export const conversationChannelEnum = pgEnum("conversation_channel", ["web_widget", "whatsapp", "email", "api", "mobile_sdk"]);
export const conversationIntentEnum = pgEnum("conversation_intent", [
  "faq",
  "product_discovery",
  "order_status",
  "support_issue",
  "lead_capture",
  "booking",
  "pricing",
  "complaint",
  "small_talk",
  "unknown",
]);
export const messageRoleEnum = pgEnum("message_role", ["customer", "assistant", "agent", "system"]);
export const deliveryStatusEnum = pgEnum("delivery_status", ["sending", "sent", "delivered", "failed"]);

export const leadStatusEnum = pgEnum("lead_status", ["new", "contacted", "qualified", "proposal", "won", "lost"]);
export const priorityEnum = pgEnum("priority", ["low", "medium", "high", "urgent"]);
export const leadSourceEnum = pgEnum("lead_source", ["ai_chatbot", "website", "manual", "import", "api"]);
export const assignmentMethodEnum = pgEnum("assignment_method", ["manual", "auto", "round_robin", "rule"]);

export const ticketStatusEnum = pgEnum("ticket_status", ["open", "assigned", "in_progress", "waiting", "resolved", "closed"]);
export const ticketCategoryEnum = pgEnum("ticket_category", [
  "order_issue",
  "delivery",
  "returns",
  "refund",
  "product_defect",
  "billing",
  "account",
  "technical",
  "other",
]);
export const ticketTimelineKindEnum = pgEnum("ticket_timeline_kind", [
  "customer_message",
  "ai_response",
  "agent_reply",
  "internal_note",
  "created",
  "assigned",
  "status_changed",
  "priority_changed",
  "category_changed",
  "escalated",
  "resolved",
  "reopened",
  "attachment_added",
]);
export const actorTypeEnum = pgEnum("actor_type", ["customer", "ai", "agent", "system"]);

export const faqStatusEnum = pgEnum("faq_status", ["published", "draft", "disabled", "archived"]);

export const knowledgeSourceTypeEnum = pgEnum("knowledge_source_type", ["pdf", "docx", "txt", "website", "manual", "csv"]);
export const processingStatusEnum = pgEnum("processing_status", ["pending", "processing", "ready", "failed", "outdated"]);

export const chatbotConfigStatusEnum = pgEnum("chatbot_config_status", ["draft", "published"]);

export const notificationCategoryEnum = pgEnum("notification_category", [
  "assignment",
  "conversation",
  "ticket",
  "lead",
  "knowledge",
  "chatbot",
  "system",
  "billing",
]);
export const notificationSeverityEnum = pgEnum("notification_severity", ["info", "success", "warning", "critical"]);

export const aiProviderStatusEnum = pgEnum("ai_provider_status", ["connected", "disconnected", "error", "rate_limited"]);
export const healthStatusEnum = pgEnum("health_status", ["operational", "degraded", "down", "maintenance"]);

export const wizardStepStatusEnum = pgEnum("wizard_step_status", ["not_started", "in_progress", "complete", "skipped"]);
export const analysisStatusEnum = pgEnum("analysis_status", ["queued", "crawling", "analyzing", "complete", "failed"]);
export const suggestionKindEnum = pgEnum("suggestion_kind", ["company_info", "product", "policy", "faq", "contact"]);
export const suggestionStatusEnum = pgEnum("suggestion_status", ["pending", "accepted", "rejected", "edited"]);

/** Where a queued email has got to. */
export const emailOutboxStatusEnum = pgEnum("email_outbox_status", ["pending", "sending", "sent", "failed"]);
