import { relations, sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";
import {
  analysisStatusEnum,
  chatbotConfigStatusEnum,
  suggestionKindEnum,
  suggestionStatusEnum,
} from "./enums";

/**
 * Chatbot configuration: one row per company, each section in its own JSONB
 * column.
 *
 * The sections are edited as units by the tabbed editor and read as units by
 * the widget, and their shape is owned by product rather than by the database —
 * a column per toggle would mean a migration every time a setting is added.
 *
 * Draft and published live on the same row but in different columns. The widget
 * is only ever served `publishedConfig`, so saving a draft cannot change what
 * customers see until someone with `chatbot.publish` publishes it.
 */
export interface ChatbotIdentity {
  botName: string;
  avatarUrl: string | null;
  avatarEmoji: string;
  welcomeMessage: string;
  inputPlaceholder: string;
  defaultLocale: string;
  supportedLocales: string[];
  tagline: string;
}

export interface ChatbotAppearance {
  theme: "light" | "dark" | "auto";
  primaryColor: string;
  position: "bottom-right" | "bottom-left" | "bottom-center";
  launcherStyle: "bubble" | "pill" | "bar";
  launcherLabel: string;
  widthPx: number;
  heightPx: number;
  cornerRadiusPx: number;
  showBranding: boolean;
  offsetXPx: number;
  offsetYPx: number;
}

export interface ChatbotBehavior {
  autoOpenDelayMs: number;
  showQuickReplies: boolean;
  quickReplies: string[];
  persistConversation: boolean;
  requireEmailBeforeChat: boolean;
  offlineMessage: string;
  respectBusinessHours: boolean;
  typingIndicator: boolean;
  allowFileUpload: boolean;
  allowConversationTranscript: boolean;
}

/**
 * Model, tone and tool selection.
 *
 * Stored and served as configuration only. Nothing in this codebase calls a
 * model with it — the AI layer will read this document when it is built.
 */
export interface ChatbotAIConfig {
  providerId: string;
  model: string;
  personality: "professional" | "friendly" | "enthusiastic" | "formal";
  responseStyle: "concise" | "balanced" | "detailed";
  creativity: number;
  maxResponseWords: number;
  allowedTopics: string[];
  blockedTopics: string[];
  fallbackResponse: string;
  systemPromptAddendum: string;
  knowledgeConfidenceThreshold: number;
  citeSources: boolean;
  enabledTools: string[];
}

export interface ChatbotKnowledgeConfig {
  faqSetIds: string[];
  collectionIds: string[];
  preferFaqOverRag: boolean;
  maxChunksPerAnswer: number;
}

export interface LeadCaptureConfig {
  enabled: boolean;
  fields: Array<{ key: string; label: string; required: boolean; enabled: boolean }>;
  qualificationQuestions: string[];
  defaultStatus: string;
  defaultAssigneeId: string | null;
  assignmentStrategy: "manual" | "round_robin" | "team" | "rule_based";
  notifyAssignee: boolean;
}

export interface TicketAutomationConfig {
  enabled: boolean;
  defaultCategory: string;
  defaultPriority: string;
  assignmentStrategy: "manual" | "round_robin" | "team" | "rule_based";
  defaultTeamId: string | null;
  requiredFields: Array<{ key: string; label: string; required: boolean }>;
  confirmBeforeCreate: boolean;
}

export interface HumanHandoffConfig {
  enabled: boolean;
  triggers: Array<"customer_request" | "ai_uncertainty" | "specific_issue" | "always">;
  uncertaintyThreshold: number;
  escalationCategories: string[];
  defaultTeamId: string | null;
  assignmentStrategy: "manual" | "round_robin" | "team" | "rule_based";
  outsideHoursMessage: string;
  queueMessage: string;
}

export const chatbotConfigs = pgTable(
  "chatbot_configs",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .unique()
      .references(() => companies.id, { onDelete: "cascade" }),
    status: chatbotConfigStatusEnum("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedById: text("published_by_id").references(() => users.id, { onDelete: "set null" }),
    publishedByName: text("published_by_name"),
    hasUnpublishedChanges: boolean("has_unpublished_changes").notNull().default(true),

    identity: jsonb("identity").$type<ChatbotIdentity>().notNull(),
    appearance: jsonb("appearance").$type<ChatbotAppearance>().notNull(),
    behavior: jsonb("behavior").$type<ChatbotBehavior>().notNull(),
    ai: jsonb("ai").$type<ChatbotAIConfig>().notNull(),
    knowledge: jsonb("knowledge").$type<ChatbotKnowledgeConfig>().notNull(),
    leads: jsonb("leads").$type<LeadCaptureConfig>().notNull(),
    tickets: jsonb("tickets").$type<TicketAutomationConfig>().notNull(),
    handoff: jsonb("handoff").$type<HumanHandoffConfig>().notNull(),

    /** The exact document served to the widget, frozen at publish time. */
    publishedConfig: jsonb("published_config").$type<PublishedChatbotConfig>(),

    /**
     * Public embed key. Identifies the tenant to the widget script; it is not a
     * secret and grants read access to published config and published FAQ only.
     */
    embedKey: text("embed_key").notNull().unique(),
    allowedDomains: text("allowed_domains").array().notNull().default(sql`'{}'::text[]`),
    verifiedDomains: text("verified_domains").array().notNull().default(sql`'{}'::text[]`),
    lastPingAt: timestamp("last_ping_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("chatbot_configs_embed_key_idx").on(table.embedKey)],
);

/** Immutable record of every publish — "who moved the handoff threshold" has an answer. */
export const chatbotConfigVersions = pgTable(
  "chatbot_config_versions",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    publishedById: text("published_by_id").references(() => users.id, { onDelete: "set null" }),
    publishedByName: text("published_by_name"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("chatbot_config_versions_idx").on(table.companyId, table.version)],
);

export interface WizardStep {
  key: string;
  ordinal: string;
  title: string;
  description: string;
  status: "not_started" | "in_progress" | "complete" | "skipped";
  optional: boolean;
  milestone: "setup" | "knowledge" | "automation" | "launch";
  completedAt: string | null;
}

export const wizardStates = pgTable("wizard_states", {
  companyId: text("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  currentStepKey: text("current_step_key").notNull().default("company"),
  steps: jsonb("steps").$type<WizardStep[]>().notNull().default(sql`'[]'::jsonb`),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastSavedAt: timestamp("last_saved_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/**
 * Website analysis for the setup wizard.
 *
 * Crawling a site and proposing FAQ answers from it is an AI-layer capability.
 * These tables exist so the wizard can read and review analyses once that layer
 * lands; nothing in this codebase creates a row with invented suggestions.
 */
export const websiteAnalyses = pgTable(
  "website_analyses",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    status: analysisStatusEnum("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    pagesCrawled: integer("pages_crawled").notNull().default(0),
    findings: jsonb("findings")
      .$type<Array<{ kind: string; label: string; count: number; status: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("website_analyses_company_idx").on(table.companyId, table.startedAt.desc())],
);

export const websiteAnalysisSuggestions = pgTable(
  "website_analysis_suggestions",
  {
    id: text("id").primaryKey(),
    analysisId: text("analysis_id")
      .notNull()
      .references(() => websiteAnalyses.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: suggestionKindEnum("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    sourceUrl: text("source_url").notNull().default(""),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull().default("0"),
    status: suggestionStatusEnum("status").notNull().default("pending"),
    /** Set when a reviewer edited the proposal before accepting it. */
    editedBody: text("edited_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("website_analysis_suggestions_analysis_idx").on(table.analysisId)],
);

export const chatbotConfigsRelations = relations(chatbotConfigs, ({ one }) => ({
  company: one(companies, { fields: [chatbotConfigs.companyId], references: [companies.id] }),
}));

/**
 * The frozen document served to the widget.
 *
 * Exactly the eight editable sections as they stood at publish time. Typed so
 * the widget can read it without casting — a published config is the one place
 * where a wrong assumption reaches a customer's screen.
 */
export interface PublishedChatbotConfig {
  identity: ChatbotIdentity;
  appearance: ChatbotAppearance;
  behavior: ChatbotBehavior;
  ai: ChatbotAIConfig;
  knowledge: ChatbotKnowledgeConfig;
  leads: LeadCaptureConfig;
  tickets: TicketAutomationConfig;
  handoff: HumanHandoffConfig;
}
