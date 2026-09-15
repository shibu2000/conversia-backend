import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  primaryKey,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companyStatusEnum, emailOutboxStatusEnum, planTierEnum } from "./enums";

/**
 * `companies` is the tenant root.
 *
 * Every table holding company-owned data carries `companyId` with a cascading
 * foreign key back to here, so removing a tenant removes its data and no orphan
 * can outlive it. Authorization never reads a company id from a request body —
 * it comes from the authenticated session and is applied as a predicate on
 * every query.
 */
export const companies = pgTable(
  "companies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logoUrl: text("logo_url"),
    website: text("website").notNull().default(""),
    industry: text("industry").notNull().default(""),
    country: text("country").notNull().default(""),
    timezone: text("timezone").notNull().default("UTC"),
    status: companyStatusEnum("status").notNull().default("onboarding"),
    plan: planTierEnum("plan").notNull().default("starter"),
    primaryContactName: text("primary_contact_name").notNull().default(""),
    primaryContactEmail: text("primary_contact_email").notNull().default(""),
    onboardingProgress: integer("onboarding_progress").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("companies_status_idx").on(table.status),
    index("companies_plan_idx").on(table.plan),
    // Trigram index so the super-admin directory's fuzzy name search stays an
    // index scan rather than a sequential scan as tenant count grows.
    index("companies_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
  ],
);

/** Usage counters for the current billing period. */
export const companyUsage = pgTable("company_usage", {
  companyId: text("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  aiRequests: integer("ai_requests").notNull().default(0),
  aiRequestQuota: integer("ai_request_quota").notNull().default(5000),
  conversations: integer("conversations").notNull().default(0),
  conversationQuota: integer("conversation_quota").notNull().default(1000),
  knowledgeDocuments: integer("knowledge_documents").notNull().default(0),
  knowledgeDocumentQuota: integer("knowledge_document_quota").notNull().default(50),
  seats: integer("seats").notNull().default(0),
  seatQuota: integer("seat_quota").notNull().default(5),
  tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
  tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 2 }).notNull().default("0"),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull().defaultNow(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull().defaultNow(),
});

export interface BusinessHours {
  timezone: string;
  /** Keyed by ISO weekday, "1" = Monday. */
  days: Record<string, { open: boolean; from: string; to: string }>;
}

export const companySettings = pgTable("company_settings", {
  companyId: text("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  businessHours: jsonb("business_hours").$type<BusinessHours>().notNull().default(sql`'{}'::jsonb`),
  supportEmail: text("support_email").notNull().default(""),
  defaultLeadOwnerId: text("default_lead_owner_id"),
  defaultTicketTeamId: text("default_ticket_team_id"),
  dataRetentionDays: integer("data_retention_days").notNull().default(730),
  locales: text("locales").array().notNull().default(sql`ARRAY['en-US']::text[]`),
  defaultLocale: text("default_locale").notNull().default("en-US"),

  /**
   * The workspace's own mail server.
   *
   * Discrete columns rather than one jsonb blob, so the password is a column the
   * settings query can simply never select — rather than a key somebody has to
   * remember to strip out of an object on the way to the browser.
   */
  emailEnabled: boolean("email_enabled").notNull().default(false),
  smtpHost: text("smtp_host").notNull().default(""),
  smtpPort: integer("smtp_port").notNull().default(587),
  /** Implicit TLS on connect (port 465). Otherwise STARTTLS is negotiated. */
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  smtpUser: text("smtp_user").notNull().default(""),
  /** AES-256-GCM, keyed from the environment. Never returned by any endpoint. */
  smtpPasswordEncrypted: text("smtp_password_encrypted"),
  smtpFromName: text("smtp_from_name").notNull().default(""),
  smtpFromEmail: text("smtp_from_email").notNull().default(""),
  /** Where new-lead mail goes when no individual was assigned — which is most of them. */
  leadNotificationEmail: text("lead_notification_email").notNull().default(""),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Mail waiting to be sent.
 *
 * Written in the same transaction as the record that prompted it, so either both
 * exist or neither does, and nothing the visitor is waiting on ever blocks on a
 * mail server. A send that fails is retried with growing delay and, if it keeps
 * failing, stays here with the reason attached — a lead notification that
 * quietly never arrived is worse than one that arrives late.
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    toEmail: text("to_email").notNull(),
    toName: text("to_name").notNull().default(""),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodyHtml: text("body_html").notNull().default(""),
    status: emailOutboxStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Not before this. Pushed out after each failure, so retries back off. */
    sendAfter: timestamp("send_after", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("email_outbox_claim_idx").on(table.status, table.sendAfter),
    index("email_outbox_company_idx").on(table.companyId, table.createdAt.desc()),
  ],
);

/** Daily rollup that backs the company trend sparklines without scanning raw rows. */
export const companyDailyStats = pgTable(
  "company_daily_stats",
  {
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    day: timestamp("day", { withTimezone: true, mode: "date" }).notNull(),
    conversations: integer("conversations").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    tickets: integer("tickets").notNull().default(0),
    aiRequests: integer("ai_requests").notNull().default(0),
  },
  (table) => [uniqueIndex("company_daily_stats_pk").on(table.companyId, table.day)],
);

export const companiesRelations = relations(companies, ({ one }) => ({
  usage: one(companyUsage, { fields: [companies.id], references: [companyUsage.companyId] }),
  settings: one(companySettings, { fields: [companies.id], references: [companySettings.companyId] }),
}));

/**
 * Monotonic per-company counters for human-facing references (`L-4231`, `#10284`).
 *
 * Deriving a reference from `count(*)` looks fine until a row is deleted — the
 * next insert reuses a reference and trips the unique index, surfacing to the
 * user as "that record already exists" when they tried to create a ticket. It
 * also races: two concurrent creates read the same count.
 *
 * `UPDATE … RETURNING` on this row is atomic and takes a row lock for the rest
 * of the transaction, so concurrent creates serialise on it and every reference
 * is handed out exactly once. Gaps after a failed transaction are fine —
 * references need to be unique and increasing, not contiguous.
 */
export const companyCounters = pgTable(
  "company_counters",
  {
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Which reference series: `lead`, `ticket`, `conversation`, `order`. */
    entity: text("entity").notNull(),
    nextValue: integer("next_value").notNull().default(1),
  },
  (table) => [primaryKey({ columns: [table.companyId, table.entity] })],
);
