import { relations, sql } from "drizzle-orm";
import { boolean, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { conversations } from "./conversations";
import { customers, orders } from "./customers";
import { teams, users } from "./users";
import { actorTypeEnum, priorityEnum, ticketCategoryEnum, ticketStatusEnum, ticketTimelineKindEnum } from "./enums";

export const tickets = pgTable(
  "tickets",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Human-facing identifier, e.g. `#10284`. */
    reference: text("reference").notNull(),
    subject: text("subject").notNull(),
    description: text("description").notNull().default(""),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    category: ticketCategoryEnum("category").notNull().default("other"),
    priority: priorityEnum("priority").notNull().default("medium"),
    status: ticketStatusEnum("status").notNull().default("open"),
    assignedUserId: text("assigned_user_id"),
    teamId: text("team_id"),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    orderId: text("order_id").references(() => orders.id, { onDelete: "set null" }),
    orderReference: text("order_reference"),
    /** True when the future AI layer filed this ticket from a conversation. */
    createdByAi: boolean("created_by_ai").notNull().default(false),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    reopenCount: integer("reopen_count").notNull().default(0),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    csatScore: integer("csat_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tickets_company_reference_idx").on(table.companyId, table.reference),
    index("tickets_company_created_idx").on(table.companyId, table.createdAt.desc()),
    index("tickets_company_status_idx").on(table.companyId, table.status),
    index("tickets_assignee_idx").on(table.companyId, table.assignedUserId),
    index("tickets_team_idx").on(table.companyId, table.teamId),
    // Partial index: the SLA queue only ever asks about unresolved tickets.
    index("tickets_sla_idx").on(table.companyId, table.slaDueAt).where(sql`resolved_at IS NULL`),
    index("tickets_subject_trgm_idx").using("gin", sql`${table.subject} gin_trgm_ops`),
    // Assignee and team must belong to the ticket's own company.
    foreignKey({
      name: "tickets_assignee_same_company",
      columns: [table.assignedUserId, table.companyId],
      foreignColumns: [users.id, users.companyId],
    }).onDelete("set null"),
    foreignKey({
      name: "tickets_team_same_company",
      columns: [table.teamId, table.companyId],
      foreignColumns: [teams.id, teams.companyId],
    }).onDelete("set null"),
  ],
);

export const ticketTimelineEvents = pgTable(
  "ticket_timeline_events",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: ticketTimelineKindEnum("kind").notNull(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    body: text("body").notNull().default(""),
    meta: jsonb("meta").$type<Record<string, string>>(),
    /** Internal notes are hidden from the customer-facing transcript. */
    isInternal: boolean("is_internal").notNull().default(false),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ticket_timeline_ticket_idx").on(table.ticketId, table.at)],
);

export const ticketAssignmentEvents = pgTable(
  "ticket_assignment_events",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    fromUserId: text("from_user_id").references(() => users.id, { onDelete: "set null" }),
    fromUserName: text("from_user_name"),
    toUserId: text("to_user_id").references(() => users.id, { onDelete: "set null" }),
    toUserName: text("to_user_name"),
    byUserId: text("by_user_id").references(() => users.id, { onDelete: "set null" }),
    byUserName: text("by_user_name").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ticket_assignment_ticket_idx").on(table.ticketId, table.at.desc())],
);

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  company: one(companies, { fields: [tickets.companyId], references: [companies.id] }),
  customer: one(customers, { fields: [tickets.customerId], references: [customers.id] }),
  assignee: one(users, { fields: [tickets.assignedUserId], references: [users.id] }),
  team: one(teams, { fields: [tickets.teamId], references: [teams.id] }),
  conversation: one(conversations, { fields: [tickets.conversationId], references: [conversations.id] }),
  timeline: many(ticketTimelineEvents),
  assignmentHistory: many(ticketAssignmentEvents),
}));

export const ticketTimelineEventsRelations = relations(ticketTimelineEvents, ({ one }) => ({
  ticket: one(tickets, { fields: [ticketTimelineEvents.ticketId], references: [tickets.id] }),
}));

export const ticketAssignmentEventsRelations = relations(ticketAssignmentEvents, ({ one }) => ({
  ticket: one(tickets, { fields: [ticketAssignmentEvents.ticketId], references: [tickets.id] }),
}));
