import { relations, sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { tsvector } from "./custom-types";
import { faqStatusEnum } from "./enums";

/**
 * FAQ: sets → arbitrarily nested categories → questions.
 *
 * FAQ is curated, human-authored content the widget can answer from directly,
 * and it is a *separate concept* from the Knowledge Base. An administrator
 * edits an FAQ answer and that exact text goes live; a knowledge document is an
 * ingested source the assistant will later quote from. They are never merged,
 * and the chatbot config selects from each independently.
 */
export const faqSets = pgTable(
  "faq_sets",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    status: faqStatusEnum("status").notNull().default("draft"),
    /** Surfaced first in the widget's "Popular questions" list. */
    isDefault: boolean("is_default").notNull().default(false),
    locale: text("locale").notNull().default("en-US"),
    matchCount30d: integer("match_count_30d").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("faq_sets_company_slug_idx").on(table.companyId, table.slug),
    index("faq_sets_company_idx").on(table.companyId),
    // At most one default set per company — enforced, not merely intended.
    uniqueIndex("faq_sets_one_default_idx").on(table.companyId).where(sql`is_default`),
  ],
);

export const faqCategories = pgTable(
  "faq_categories",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    setId: text("set_id")
      .notNull()
      .references(() => faqSets.id, { onDelete: "cascade" }),
    /** Self-reference: deleting a category removes its whole subtree. */
    parentId: text("parent_id"),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Sibling ordering within the same parent. */
    sortOrder: integer("sort_order").notNull().default(0),
    depth: integer("depth").notNull().default(0),
    status: faqStatusEnum("status").notNull().default("published"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("faq_categories_set_idx").on(table.setId, table.parentId, table.sortOrder),
    index("faq_categories_company_idx").on(table.companyId),
  ],
);

export const faqs = pgTable(
  "faqs",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    setId: text("set_id")
      .notNull()
      .references(() => faqSets.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => faqCategories.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull().default(""),
    keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
    status: faqStatusEnum("status").notNull().default("draft"),
    /** Higher wins when several FAQs match one query. */
    priority: integer("priority").notNull().default(5),
    sortOrder: integer("sort_order").notNull().default(0),
    matchCount30d: integer("match_count_30d").notNull().default(0),
    helpfulCount: integer("helpful_count").notNull().default(0),
    notHelpfulCount: integer("not_helpful_count").notNull().default(0),
    lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),
    /** Set when the entry came from the AI-assisted setup wizard. */
    aiSuggested: boolean("ai_suggested").notNull().default(false),
    /**
     * Weighted full-text index over the curated text.
     *
     * This is ordinary lexical search, not semantic retrieval. It powers the
     * admin filter and the widget's "is there a published answer for this"
     * lookup — both of which return text a person wrote and approved.
     *
     * `keywords` is deliberately not folded in here: `array_to_string` is only
     * STABLE, and Postgres requires a generated expression to be IMMUTABLE.
     * Keyword matching runs against the GIN array index below instead, which is
     * a cheaper containment check than a text match would have been anyway.
     */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english'::regconfig, coalesce(question, '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce(answer, '')), 'B')`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("faqs_set_idx").on(table.setId, table.categoryId, table.sortOrder),
    index("faqs_company_idx").on(table.companyId),
    index("faqs_status_idx").on(table.companyId, table.status),
    index("faqs_keywords_idx").using("gin", table.keywords),
    index("faqs_search_idx").using("gin", table.searchVector),
  ],
);

export const faqSetsRelations = relations(faqSets, ({ one, many }) => ({
  company: one(companies, { fields: [faqSets.companyId], references: [companies.id] }),
  categories: many(faqCategories),
  questions: many(faqs),
}));

export const faqCategoriesRelations = relations(faqCategories, ({ one, many }) => ({
  set: one(faqSets, { fields: [faqCategories.setId], references: [faqSets.id] }),
  questions: many(faqs),
}));

export const faqsRelations = relations(faqs, ({ one }) => ({
  set: one(faqSets, { fields: [faqs.setId], references: [faqSets.id] }),
  category: one(faqCategories, { fields: [faqs.categoryId], references: [faqCategories.id] }),
}));
