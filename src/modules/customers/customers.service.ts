import { and, arrayOverlaps, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { bookings, conversations, customers, leads, orders, tickets } from "../../db/schema";
import { notFound } from "../../core/errors";
import { newId } from "../../core/ids";
import { correlatedCount } from "../../core/subquery";
import { likePattern, paginate, resolveOrderBy, type ListQuery, type Paginated } from "../../core/list-query";
import { listForCustomer as listConversationsForCustomer } from "../conversations/conversations.service";
import { listForCustomer as listLeadsForCustomer } from "../leads/leads.service";
import { listForCustomer as listTicketsForCustomer } from "../tickets/tickets.service";
import { toBooking, toCustomer, toOrder } from "./customers.mapper";
import type { CreateCustomerInput, UpdateCustomerInput } from "./customers.schema";

/** Per-customer counters, as correlated subqueries against indexed columns. */
const conversationCount = correlatedCount({ from: "conversations", as: "cv", on: "cv.customer_id = customers.id" });
const leadCount = correlatedCount({ from: "leads", as: "l", on: "l.customer_id = customers.id" });
const ticketCount = correlatedCount({ from: "tickets", as: "t", on: "t.customer_id = customers.id" });
const orderCount = correlatedCount({ from: "orders", as: "o", on: "o.customer_id = customers.id" });

const SORT_COLUMNS = {
  name: customers.name,
  lastSeen: customers.lastSeenAt,
  value: customers.lifetimeValueUsd,
  createdAt: customers.createdAt,
  conversations: conversationCount,
  tickets: ticketCount,
  orders: orderCount,
};

export async function listCustomers(companyId: string, query: ListQuery): Promise<Paginated<ReturnType<typeof toCustomer>>> {
  const conditions = [eq(customers.companyId, companyId)];

  if (query.search) {
    const pattern = likePattern(query.search);
    conditions.push(
      or(
        ilike(customers.name, pattern),
        ilike(customers.email, pattern),
        ilike(customers.phone, pattern),
        ilike(customers.companyName, pattern),
      )!,
    );
  }
  if (query.filters.status) conditions.push(inArray(customers.status, query.filters.status as never));
  if (query.filters.country) conditions.push(inArray(customers.country, query.filters.country));
  if (query.filters.channel) conditions.push(inArray(customers.firstSeenChannel, query.filters.channel as never));
  // Tags are an array column: overlap is served by the GIN index. It has to go
  // through `arrayOverlaps` rather than a `sql` template, which expands a JS
  // array into a parenthesised list and produces a record, not an array.
  if (query.filters.tag) conditions.push(arrayOverlaps(customers.tags, query.filters.tag));

  const where = and(...conditions);

  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(customers).where(where),
    db
      .select({ customer: customers, conversationCount, leadCount, ticketCount, orderCount })
      .from(customers)
      .where(where)
      .orderBy(resolveOrderBy(query, SORT_COLUMNS, "name"))
      .limit(query.pageSize)
      .offset(query.offset),
  ]);

  return paginate(
    rows.map((row) =>
      toCustomer(row.customer, {
        conversationCount: Number(row.conversationCount),
        leadCount: Number(row.leadCount),
        ticketCount: Number(row.ticketCount),
        orderCount: Number(row.orderCount),
      }),
    ),
    Number(total?.value ?? 0),
    query,
  );
}

export async function getCustomer(companyId: string, customerId: string) {
  const [row] = await db
    .select({ customer: customers, conversationCount, leadCount, ticketCount, orderCount })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
    .limit(1);

  if (!row) throw notFound("Customer", customerId);

  return toCustomer(row.customer, {
    conversationCount: Number(row.conversationCount),
    leadCount: Number(row.leadCount),
    ticketCount: Number(row.ticketCount),
    orderCount: Number(row.orderCount),
  });
}

export async function createCustomer(companyId: string, input: CreateCustomerInput) {
  const id = newId("cus");

  await db.insert(customers).values({
    id,
    companyId,
    name: input.name,
    email: input.email || null,
    phone: input.phone || null,
    companyName: input.company || null,
    country: input.country ?? "",
    locale: input.locale ?? "en-US",
    status: "lead",
    tags: input.tags ?? [],
    firstSeenChannel: "manual",
    notes: input.notes || null,
  });

  return getCustomer(companyId, id);
}

export async function updateCustomer(companyId: string, customerId: string, patch: UpdateCustomerInput) {
  const { company, ...rest } = patch;

  const [updated] = await db
    .update(customers)
    .set({
      ...rest,
      ...(company !== undefined ? { companyName: company || null } : {}),
      ...(rest.email !== undefined ? { email: rest.email || null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
    .returning({ id: customers.id });

  if (!updated) throw notFound("Customer", customerId);
  return getCustomer(companyId, customerId);
}

export async function deleteCustomer(companyId: string, customerId: string) {
  const [deleted] = await db
    .delete(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
    .returning({ id: customers.id });

  if (!deleted) throw notFound("Customer", customerId);
}

/**
 * The unified customer profile.
 *
 * One round trip, because every tab of the profile page is shown together —
 * five sequential requests would each paint a separate loading state for the
 * same screen.
 */
export async function getCustomerProfile(companyId: string, customerId: string) {
  const customer = await getCustomer(companyId, customerId);

  const [customerConversations, customerLeads, customerTickets, customerOrders, customerBookings] = await Promise.all([
    listConversationsForCustomer(companyId, customerId),
    listLeadsForCustomer(companyId, customerId),
    listTicketsForCustomer(companyId, customerId),
    db
      .select()
      .from(orders)
      .where(and(eq(orders.customerId, customerId), eq(orders.companyId, companyId)))
      .orderBy(desc(orders.placedAt))
      .limit(100),
    db
      .select()
      .from(bookings)
      .where(and(eq(bookings.customerId, customerId), eq(bookings.companyId, companyId)))
      .orderBy(desc(bookings.scheduledFor))
      .limit(100),
  ]);

  return {
    customer,
    conversations: customerConversations,
    leads: customerLeads,
    tickets: customerTickets,
    orders: customerOrders.map(toOrder),
    bookings: customerBookings.map(toBooking),
  };
}

export async function filterOptions(companyId: string) {
  const [countries, tagRows] = await Promise.all([
    db
      .selectDistinct({ value: customers.country })
      .from(customers)
      .where(eq(customers.companyId, companyId))
      .orderBy(asc(customers.country)),
    db.execute<{ tag: string }>(sql`
      SELECT DISTINCT unnest(${customers.tags}) AS tag
        FROM ${customers}
       WHERE ${customers.companyId} = ${companyId}
       ORDER BY tag
    `),
  ]);

  const tags = (tagRows.rows ?? (tagRows as unknown as Array<{ tag: string }>)).map((row) => row.tag).filter(Boolean);
  return { countries: countries.map((row) => row.value).filter(Boolean), tags };
}
