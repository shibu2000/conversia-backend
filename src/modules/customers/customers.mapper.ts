import { isoRequired, num } from "../../core/serialize";
import type { customers } from "../../db/schema";

type CustomerRow = typeof customers.$inferSelect;

export interface CustomerCounts {
  conversationCount: number;
  leadCount: number;
  ticketCount: number;
  orderCount: number;
}

export function toCustomer(row: CustomerRow, counts: CustomerCounts) {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    avatarUrl: row.avatarUrl ?? undefined,
    // The frontend calls the customer's own employer `company`; the column is
    // `company_name` because `company_id` already means the tenant.
    company: row.companyName ?? undefined,
    country: row.country,
    locale: row.locale,
    status: row.status,
    tags: row.tags,
    firstSeenChannel: row.firstSeenChannel,
    lastSeenAt: isoRequired(row.lastSeenAt),
    conversationCount: Number(counts.conversationCount),
    leadCount: Number(counts.leadCount),
    ticketCount: Number(counts.ticketCount),
    orderCount: Number(counts.orderCount),
    lifetimeValueUsd: num(row.lifetimeValueUsd),
    notes: row.notes ?? undefined,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export function toOrder(row: {
  id: string;
  companyId: string;
  customerId: string;
  reference: string;
  status: string;
  totalUsd: string | number;
  currency: string;
  itemCount: number;
  items: unknown;
  placedAt: Date;
}) {
  return {
    id: row.id,
    companyId: row.companyId,
    customerId: row.customerId,
    reference: row.reference,
    status: row.status,
    totalUsd: num(row.totalUsd),
    currency: row.currency,
    itemCount: row.itemCount,
    placedAt: isoRequired(row.placedAt),
    items: row.items ?? [],
  };
}

export function toBooking(row: {
  id: string;
  companyId: string;
  customerId: string;
  reference: string;
  type: string;
  status: string;
  scheduledFor: Date;
  durationMinutes: number;
  assignedUserId: string | null;
  location: string;
  notes: string | null;
}) {
  return {
    id: row.id,
    companyId: row.companyId,
    customerId: row.customerId,
    reference: row.reference,
    type: row.type,
    status: row.status,
    scheduledFor: isoRequired(row.scheduledFor),
    durationMinutes: row.durationMinutes,
    assignedUserId: row.assignedUserId,
    location: row.location,
    notes: row.notes ?? undefined,
  };
}
