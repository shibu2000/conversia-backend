import { relations, sql } from "drizzle-orm";
import { bigint, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";
import { bookingStatusEnum, customerChannelEnum, customerStatusEnum, orderStatusEnum } from "./enums";

export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    avatarUrl: text("avatar_url"),
    /** The customer's own employer, not the tenant. */
    companyName: text("company_name"),
    country: text("country").notNull().default(""),
    locale: text("locale").notNull().default("en-US"),
    status: customerStatusEnum("status").notNull().default("lead"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    firstSeenChannel: customerChannelEnum("first_seen_channel").notNull().default("manual"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lifetimeValueUsd: numeric("lifetime_value_usd", { precision: 12, scale: 2 }).notNull().default("0"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("customers_company_idx").on(table.companyId),
    index("customers_company_status_idx").on(table.companyId, table.status),
    index("customers_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
    index("customers_email_idx").on(table.companyId, sql`lower(${table.email})`),
    index("customers_tags_idx").using("gin", table.tags),
  ],
);

export interface OrderItem {
  productId: string;
  name: string;
  qty: number;
  priceUsd: number;
}

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    status: orderStatusEnum("status").notNull().default("pending"),
    totalUsd: numeric("total_usd", { precision: 12, scale: 2 }).notNull().default("0"),
    currency: text("currency").notNull().default("USD"),
    itemCount: integer("item_count").notNull().default(0),
    items: jsonb("items").$type<OrderItem[]>().notNull().default(sql`'[]'::jsonb`),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("orders_company_reference_idx").on(table.companyId, table.reference),
    index("orders_customer_idx").on(table.customerId, table.placedAt.desc()),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    type: text("type").notNull().default(""),
    status: bookingStatusEnum("status").notNull().default("requested"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    assignedUserId: text("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    location: text("location").notNull().default(""),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("bookings_company_reference_idx").on(table.companyId, table.reference),
    index("bookings_customer_idx").on(table.customerId, table.scheduledFor.desc()),
  ],
);

export const customersRelations = relations(customers, ({ one, many }) => ({
  company: one(companies, { fields: [customers.companyId], references: [companies.id] }),
  orders: many(orders),
  bookings: many(bookings),
}));
