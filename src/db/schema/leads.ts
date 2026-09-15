import { relations, sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { conversations } from "./conversations";
import { customers } from "./customers";
import { products } from "./products";
import { users } from "./users";
import { assignmentMethodEnum, leadSourceEnum, leadStatusEnum, priorityEnum } from "./enums";

export interface QualificationAnswer {
  question: string;
  answer: string;
}

export const leads = pgTable(
  "leads",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** Free-text summary of what the customer wants. */
    interest: text("interest").notNull().default(""),
    status: leadStatusEnum("status").notNull().default("new"),
    priority: priorityEnum("priority").notNull().default("medium"),
    source: leadSourceEnum("source").notNull().default("manual"),
    assignedUserId: text("assigned_user_id"),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    estimatedValueUsd: numeric("estimated_value_usd", { precision: 12, scale: 2 }),
    /** 0–100. Written by the AI qualification step once that layer exists. */
    score: integer("score").notNull().default(50),
    qualificationAnswers: jsonb("qualification_answers")
      .$type<QualificationAnswer[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    lostReason: text("lost_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("leads_company_reference_idx").on(table.companyId, table.reference),
    index("leads_company_created_idx").on(table.companyId, table.createdAt.desc()),
    index("leads_company_status_idx").on(table.companyId, table.status),
    index("leads_assignee_idx").on(table.companyId, table.assignedUserId),
    index("leads_follow_up_idx").on(table.companyId, table.nextFollowUpAt).where(sql`next_follow_up_at IS NOT NULL`),
    index("leads_interest_trgm_idx").using("gin", sql`${table.interest} gin_trgm_ops`),
    // A lead may only be assigned to a user in the same company. Enforced by
    // the database so a bug in application code cannot leak work across tenants.
    foreignKey({
      name: "leads_assignee_same_company",
      columns: [table.assignedUserId, table.companyId],
      foreignColumns: [users.id, users.companyId],
    }).onDelete("set null"),
  ],
);

export const leadProducts = pgTable(
  "lead_products",
  {
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.leadId, table.productId] }), index("lead_products_product_idx").on(table.productId)],
);

/**
 * The assignment audit trail.
 *
 * A table rather than a JSON column on the lead: the detail page treats this as
 * an audit trail, and an audit trail you can only read by parsing a document is
 * one nobody queries. Names are denormalised alongside the ids so history stays
 * readable after a user is deleted.
 */
export const leadAssignmentEvents = pgTable(
  "lead_assignment_events",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    fromUserId: text("from_user_id").references(() => users.id, { onDelete: "set null" }),
    fromUserName: text("from_user_name"),
    toUserId: text("to_user_id").references(() => users.id, { onDelete: "set null" }),
    toUserName: text("to_user_name"),
    byUserId: text("by_user_id").references(() => users.id, { onDelete: "set null" }),
    byUserName: text("by_user_name").notNull(),
    method: assignmentMethodEnum("method").notNull().default("manual"),
    reason: text("reason"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("lead_assignment_events_lead_idx").on(table.leadId, table.at.desc())],
);

export const leadNotes = pgTable(
  "lead_notes",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("lead_notes_lead_idx").on(table.leadId, table.at.desc())],
);

export const leadsRelations = relations(leads, ({ one, many }) => ({
  company: one(companies, { fields: [leads.companyId], references: [companies.id] }),
  customer: one(customers, { fields: [leads.customerId], references: [customers.id] }),
  assignee: one(users, { fields: [leads.assignedUserId], references: [users.id] }),
  conversation: one(conversations, { fields: [leads.conversationId], references: [conversations.id] }),
  assignmentHistory: many(leadAssignmentEvents),
  notes: many(leadNotes),
  products: many(leadProducts),
}));

export const leadAssignmentEventsRelations = relations(leadAssignmentEvents, ({ one }) => ({
  lead: one(leads, { fields: [leadAssignmentEvents.leadId], references: [leads.id] }),
}));

export const leadNotesRelations = relations(leadNotes, ({ one }) => ({
  lead: one(leads, { fields: [leadNotes.leadId], references: [leads.id] }),
}));

export const leadProductsRelations = relations(leadProducts, ({ one }) => ({
  lead: one(leads, { fields: [leadProducts.leadId], references: [leads.id] }),
  product: one(products, { fields: [leadProducts.productId], references: [products.id] }),
}));
