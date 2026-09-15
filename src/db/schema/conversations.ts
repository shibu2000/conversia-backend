import { relations, sql } from "drizzle-orm";
import {
  boolean,
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
import { customers } from "./customers";
import { products } from "./products";
import { users } from "./users";
import {
  conversationChannelEnum,
  conversationIntentEnum,
  conversationStatusEnum,
  deliveryStatusEnum,
  messageRoleEnum,
} from "./enums";

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    /**
     * Null until the visitor identifies themselves.
     *
     * A widget conversation exists from the first question, which is long
     * before anyone knows who is asking. Creating a placeholder customer per
     * visitor would fill the directory with empty records from bounces and
     * bots; the conversation is attached to a real customer the moment one
     * submits a lead, a ticket or an email address.
     */
    customerId: text("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    /** Shown in the inbox until a customer is attached, e.g. "Visitor 4f2a". */
    visitorLabel: text("visitor_label"),
    channel: conversationChannelEnum("channel").notNull().default("web_widget"),
    status: conversationStatusEnum("status").notNull().default("active"),
    intent: conversationIntentEnum("intent").notNull().default("unknown"),
    subject: text("subject").notNull().default(""),
    /** Last message preview, denormalised for the inbox list. */
    preview: text("preview").notNull().default(""),
    assignedUserId: text("assigned_user_id"),
    /** Set once the conversation produces a lead or a ticket. */
    leadId: text("lead_id"),
    ticketId: text("ticket_id"),
    messageCount: integer("message_count").notNull().default(0),
    unreadCount: integer("unread_count").notNull().default(0),
    /** True when the assistant closed it with no human involvement. */
    resolvedByAi: boolean("resolved_by_ai").notNull().default(false),
    aiConfidence: numeric("ai_confidence", { precision: 4, scale: 3 }).notNull().default("0"),
    csatScore: integer("csat_score"),
    firstResponseSeconds: integer("first_response_seconds"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    locale: text("locale").notNull().default("en-US"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("conversations_company_reference_idx").on(table.companyId, table.reference),
    index("conversations_company_last_message_idx").on(table.companyId, table.lastMessageAt.desc()),
    index("conversations_company_status_idx").on(table.companyId, table.status),
    index("conversations_assignee_idx").on(table.companyId, table.assignedUserId),
    index("conversations_customer_idx").on(table.customerId, table.lastMessageAt.desc()),
    index("conversations_subject_trgm_idx").using("gin", sql`${table.subject} gin_trgm_ops`),
    // A conversation may only be assigned to a user in its own company. This is
    // a tenancy invariant, so it is a constraint rather than a code convention.
    // MATCH SIMPLE skips the check when `assigned_user_id` is NULL, leaving
    // unassigned rows unaffected.
    foreignKey({
      name: "conversations_assignee_same_company",
      columns: [table.assignedUserId, table.companyId],
      foreignColumns: [users.id, users.companyId],
    }).onDelete("set null"),
  ],
);

/** Products mentioned in a conversation — a join table, so "which conversations
 * mentioned this product" is an index scan rather than an array scan. */
export const conversationProducts = pgTable(
  "conversation_products",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.productId] }),
    index("conversation_products_product_idx").on(table.productId),
  ],
);

/**
 * The engine's own trace for a non-prose turn.
 *
 * This is the shape the AI trace drawer renders. Nothing in this codebase
 * writes one — it is populated by the future AI layer, and the column exists so
 * that layer needs no migration.
 */
export interface MessageEvent {
  kind:
    | "intent_classified"
    | "knowledge_retrieved"
    | "faq_matched"
    | "tool_called"
    | "lead_created"
    | "ticket_created"
    | "handoff_requested"
    | "handoff_accepted"
    | "assignment_changed"
    | "status_changed"
    | "note_added";
  detail: string;
  intent?: string;
  confidence?: number;
  chunks?: Array<{
    chunkId: string;
    documentId: string;
    documentName: string;
    chunkIndex: number;
    similarity: number;
    excerpt: string;
  }>;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    status: "success" | "error" | "timeout";
    durationMs: number;
    resultSummary: string;
  };
  targetId?: string;
}

export interface MessageAttachment {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
}

export interface ProductReference {
  productId: string;
  name: string;
  priceUsd: number;
  imageUrl?: string;
  rating?: number;
  url?: string;
}

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name"),
    body: text("body").notNull().default(""),
    event: jsonb("event").$type<MessageEvent>(),
    attachments: jsonb("attachments").$type<MessageAttachment[]>().notNull().default(sql`'[]'::jsonb`),
    products: jsonb("products").$type<ProductReference[]>().notNull().default(sql`'[]'::jsonb`),
    quickReplies: text("quick_replies").array().notNull().default(sql`'{}'::text[]`),
    /** Internal notes are never returned to the widget. */
    isInternal: boolean("is_internal").notNull().default(false),
    deliveryStatus: deliveryStatusEnum("delivery_status"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("messages_conversation_at_idx").on(table.conversationId, table.at),
    index("messages_company_idx").on(table.companyId),
  ],
);

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  company: one(companies, { fields: [conversations.companyId], references: [companies.id] }),
  customer: one(customers, { fields: [conversations.customerId], references: [customers.id] }),
  assignee: one(users, { fields: [conversations.assignedUserId], references: [users.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
  author: one(users, { fields: [messages.authorId], references: [users.id] }),
}));
