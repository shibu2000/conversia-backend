import { relations, sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { inventoryStatusEnum, productStatusEnum } from "./enums";

export const productCategories = pgTable(
  "product_categories",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    parentId: text("parent_id"),
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("product_categories_company_slug_idx").on(table.companyId, table.slug),
    index("product_categories_company_idx").on(table.companyId),
  ],
);

export interface ProductImage {
  id: string;
  url: string;
  alt: string;
  isPrimary: boolean;
}

export interface ProductAttribute {
  name: string;
  value: string;
}

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    shortDescription: text("short_description").notNull().default(""),
    description: text("description").notNull().default(""),
    categoryId: text("category_id").references(() => productCategories.id, { onDelete: "set null" }),
    status: productStatusEnum("status").notNull().default("draft"),
    priceUsd: numeric("price_usd", { precision: 12, scale: 2 }).notNull().default("0"),
    compareAtPriceUsd: numeric("compare_at_price_usd", { precision: 12, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    inventoryStatus: inventoryStatusEnum("inventory_status").notNull().default("out_of_stock"),
    stockQty: integer("stock_qty").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(10),
    images: jsonb("images").$type<ProductImage[]>().notNull().default(sql`'[]'::jsonb`),
    attributes: jsonb("attributes").$type<ProductAttribute[]>().notNull().default(sql`'[]'::jsonb`),
    rating: numeric("rating", { precision: 3, scale: 2 }),
    reviewCount: integer("review_count").notNull().default(0),
    url: text("url"),

    // Merchandising metadata the future AI product-discovery tool will search
    // over. Kept as first-class columns so it can be tuned without touching
    // catalogue copy — and so it is queryable today by ordinary catalogue search.
    aiKeywords: text("ai_keywords").array().notNull().default(sql`'{}'::text[]`),
    aiUseCases: text("ai_use_cases").array().notNull().default(sql`'{}'::text[]`),
    aiAudience: text("ai_audience").array().notNull().default(sql`'{}'::text[]`),
    aiTalkingPoints: text("ai_talking_points").array().notNull().default(sql`'{}'::text[]`),
    aiIncludeInRecommendations: boolean("ai_include_in_recommendations").notNull().default(false),

    leadCount: integer("lead_count").notNull().default(0),
    conversationMentions: integer("conversation_mentions").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("products_company_sku_idx").on(table.companyId, sql`lower(${table.sku})`),
    index("products_company_idx").on(table.companyId),
    index("products_company_status_idx").on(table.companyId, table.status),
    index("products_category_idx").on(table.categoryId),
    index("products_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
    index("products_ai_keywords_idx").using("gin", table.aiKeywords),
  ],
);

export const productsRelations = relations(products, ({ one }) => ({
  company: one(companies, { fields: [products.companyId], references: [companies.id] }),
  category: one(productCategories, { fields: [products.categoryId], references: [productCategories.id] }),
}));

export const productCategoriesRelations = relations(productCategories, ({ one, many }) => ({
  company: one(companies, { fields: [productCategories.companyId], references: [companies.id] }),
  products: many(products),
}));
