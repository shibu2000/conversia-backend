import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";
import {
  aiProviderStatusEnum,
  healthStatusEnum,
  notificationCategoryEnum,
  notificationSeverityEnum,
} from "./enums";

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: notificationCategoryEnum("category").notNull(),
    severity: notificationSeverityEnum("severity").notNull().default("info"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    read: boolean("read").notNull().default(false),
    /** In-app destination. */
    href: text("href"),
    actorName: text("actor_name"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notifications_user_at_idx").on(table.userId, table.at.desc()),
    // Partial index: the unread badge is the hot query and only wants unread rows.
    index("notifications_unread_idx").on(table.userId).where(sql`NOT read`),
  ],
);

export interface AIProviderModel {
  id: string;
  label: string;
  contextWindow: number;
  inputCostPerMTok: number;
  outputCostPerMTok: number;
  capabilities: Array<"chat" | "tools" | "vision" | "embedding" | "reranking">;
  recommended?: boolean;
}

/**
 * Providers the platform can route inference to.
 *
 * This is a registry, not a client. Credentials are not stored here and no code
 * in this repository calls any of these endpoints — the AI layer will own that.
 */
export const aiProviders = pgTable("ai_providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  vendor: text("vendor").notNull(),
  status: aiProviderStatusEnum("status").notNull().default("disconnected"),
  isDefault: boolean("is_default").notNull().default(false),
  region: text("region").notNull().default(""),
  models: jsonb("models").$type<AIProviderModel[]>().notNull().default(sql`'[]'::jsonb`),
  monthlyRequests: bigint("monthly_requests", { mode: "number" }).notNull().default(0),
  monthlySpendUsd: numeric("monthly_spend_usd", { precision: 12, scale: 2 }).notNull().default("0"),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastErrorMessage: text("last_error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const platformHealthChecks = pgTable("platform_health_checks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: healthStatusEnum("status").notNull().default("operational"),
  latencyMs: integer("latency_ms").notNull().default(0),
  uptimePct: numeric("uptime_pct", { precision: 6, scale: 3 }).notNull().default("100"),
  detail: text("detail").notNull().default(""),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().defaultNow(),
});
