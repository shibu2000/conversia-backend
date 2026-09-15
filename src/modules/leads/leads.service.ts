import { and, count, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db, type Transaction } from "../../db";
import {
  activityEvents,
  customers,
  leadAssignmentEvents,
  leadNotes,
  leadProducts,
  leads,
  notifications,
  products,
  roles,
  users,
} from "../../db/schema";
import { notFound, validationError } from "../../core/errors";
import { newId } from "../../core/ids";
import { likePattern, paginate, resolveOrderBy, type ListQuery, type Paginated } from "../../core/list-query";
import type { AuthContext } from "../auth/auth.types";
import { assertAssignableUser } from "../shared/assignment.service";
import { formatLeadReference, nextReference } from "../shared/reference.service";
import { toLead } from "./leads.mapper";
import type { CreateLeadInput, UpdateLeadInput } from "./leads.schema";
import { notifyNewRecord } from "../notifications/notifications.service";
import { queueLeadEmail } from "../email/lead-notification";
import { wakeEmailWorker } from "../email/worker";

/** Priority sorts by urgency, not alphabetically — "urgent" must top "low". */
const PRIORITY_RANK = sql`CASE ${leads.priority} WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`;

const SORT_COLUMNS = {
  createdAt: leads.createdAt,
  customer: customers.name,
  status: leads.status,
  priority: PRIORITY_RANK,
  score: leads.score,
  value: leads.estimatedValueUsd,
  assignee: users.name,
  lastActivity: leads.lastActivityAt,
  followUp: leads.nextFollowUpAt,
};

export async function listLeads(companyId: string, query: ListQuery): Promise<Paginated<ReturnType<typeof toLead>>> {
  const conditions: SQL[] = [eq(leads.companyId, companyId)];

  if (query.search) {
    const pattern = likePattern(query.search);
    conditions.push(
      or(
        ilike(customers.name, pattern),
        ilike(leads.interest, pattern),
        ilike(leads.reference, pattern),
        ilike(customers.email, pattern),
      )!,
    );
  }
  if (query.filters.status) conditions.push(inArray(leads.status, query.filters.status as never));
  if (query.filters.priority) conditions.push(inArray(leads.priority, query.filters.priority as never));
  if (query.filters.source) conditions.push(inArray(leads.source, query.filters.source as never));
  if (query.filters.assignedUserId) {
    const wanted = query.filters.assignedUserId;
    conditions.push(
      wanted.includes("unassigned")
        ? or(isNull(leads.assignedUserId), inArray(leads.assignedUserId, wanted))!
        : inArray(leads.assignedUserId, wanted),
    );
  }
  if (query.filters.productId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${leadProducts} WHERE ${leadProducts.leadId} = ${leads.id} AND ${leadProducts.productId} = ANY(${query.filters.productId}))`,
    );
  }

  const where = and(...conditions);

  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(leads).innerJoin(customers, eq(customers.id, leads.customerId)).where(where),
    db
      .select({
        lead: leads,
        customerName: customers.name,
        customerEmail: customers.email,
        customerPhone: customers.phone,
        assignedUserName: users.name,
        assignedUserRole: roles.name,
      })
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .leftJoin(users, eq(users.id, leads.assignedUserId))
      .leftJoin(roles, eq(roles.id, users.roleId))
      .where(where)
      .orderBy(resolveOrderBy(query, SORT_COLUMNS, "createdAt"))
      .limit(query.pageSize)
      .offset(query.offset),
  ]);

  const productsByLead = await productNamesFor(rows.map((row) => row.lead.id));

  return paginate(
    rows.map((row) =>
      toLead(row.lead, {
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        customerPhone: row.customerPhone,
        assignedUserName: row.assignedUserName,
        assignedUserRole: row.assignedUserRole,
        productIds: productsByLead.get(row.lead.id)?.ids ?? [],
        productNames: productsByLead.get(row.lead.id)?.names ?? [],
      }),
    ),
    Number(total?.value ?? 0),
    query,
  );
}

/** One lead, with its full assignment history and notes. */
export async function getLead(companyId: string, leadId: string) {
  const [row] = await db
    .select({
      lead: leads,
      customerName: customers.name,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      assignedUserName: users.name,
      assignedUserRole: roles.name,
    })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .leftJoin(users, eq(users.id, leads.assignedUserId))
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
    .limit(1);

  if (!row) throw notFound("Lead", leadId);

  const [history, notes, productsByLead] = await Promise.all([
    db
      .select()
      .from(leadAssignmentEvents)
      .where(eq(leadAssignmentEvents.leadId, leadId))
      .orderBy(desc(leadAssignmentEvents.at)),
    db.select().from(leadNotes).where(eq(leadNotes.leadId, leadId)).orderBy(desc(leadNotes.at)),
    productNamesFor([leadId]),
  ]);

  return toLead(row.lead, {
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    assignedUserName: row.assignedUserName,
    assignedUserRole: row.assignedUserRole,
    productIds: productsByLead.get(leadId)?.ids ?? [],
    productNames: productsByLead.get(leadId)?.names ?? [],
    assignmentHistory: history,
    notes,
  });
}

export async function createLead(companyId: string, auth: AuthContext, input: CreateLeadInput) {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.companyId, companyId)))
    .limit(1);

  if (!customer) {
    throw validationError("That customer is not in this workspace.", { customerId: "Choose a customer from your workspace." });
  }

  if (input.assignedUserId) await assertAssignableUser(companyId, input.assignedUserId);

  const leadId = newId("lead");
  let reference = "";

  await db.transaction(async (tx) => {
    reference = await nextReference(tx, companyId, "lead", formatLeadReference);

    await tx.insert(leads).values({
      id: leadId,
      companyId,
      reference,
      customerId: input.customerId,
      interest: input.interest,
      status: "new",
      priority: input.priority,
      source: "manual",
      assignedUserId: input.assignedUserId ?? null,
      estimatedValueUsd: input.estimatedValueUsd != null ? String(input.estimatedValueUsd) : null,
      score: 50,
      tags: input.tags,
      nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null,
    });

    await linkProducts(tx, companyId, leadId, input.productIds);

    /**
     * A lead typed in by hand reaches the team the same way one from the widget
     * does.
     *
     * This path notified nobody at all: it wrote an activity event and stopped,
     * so a lead entered by one salesperson was invisible to everyone else. The
     * asymmetry was an oversight rather than a decision.
     */
    await notifyNewRecord(tx, companyId, {
      kind: "lead",
      reference,
      summary: input.interest,
      href: `/company/leads/${leadId}`,
      assignedUserId: input.assignedUserId ?? null,
      customerName: auth.name,
    });

    await queueLeadEmail(tx, companyId, {
      reference,
      interest: input.interest,
      qualification: [],
      leadId,
      source: `Added by ${auth.name}`,
      customerId: input.customerId,
      assignedUserId: input.assignedUserId ?? null,
    });

    // An assignment made at creation belongs in the history exactly like a
    // later one — otherwise the audit trail starts with a gap.
    if (input.assignedUserId) {
      const assignee = await userName(tx, input.assignedUserId);
      await tx.insert(leadAssignmentEvents).values({
        id: newId("lah"),
        leadId,
        companyId,
        fromUserId: null,
        fromUserName: null,
        toUserId: input.assignedUserId,
        toUserName: assignee,
        byUserId: auth.userId,
        byUserName: auth.name,
        method: "manual",
      });
    }

    await tx.insert(activityEvents).values({
      id: newId("act"),
      companyId,
      actorId: auth.userId,
      actorName: auth.name,
      action: "lead.created",
      summary: `Created lead — ${input.interest.slice(0, 120)}`,
      targetType: "lead",
      targetId: leadId,
    });
  });

  wakeEmailWorker();

  return getLead(companyId, leadId);
}

export async function updateLead(companyId: string, leadId: string, patch: UpdateLeadInput) {
  const { productIds, estimatedValueUsd, nextFollowUpAt, ...fields } = patch;
  const now = new Date();

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
      .limit(1);
    if (!existing) throw notFound("Lead", leadId);

    await tx
      .update(leads)
      .set({
        ...fields,
        ...(estimatedValueUsd !== undefined
          ? { estimatedValueUsd: estimatedValueUsd === null ? null : String(estimatedValueUsd) }
          : {}),
        ...(nextFollowUpAt !== undefined
          ? { nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : null }
          : {}),
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(leads.id, leadId));

    if (productIds) {
      await tx.delete(leadProducts).where(eq(leadProducts.leadId, leadId));
      await linkProducts(tx, companyId, leadId, productIds);
    }
  });

  return getLead(companyId, leadId);
}

/**
 * Move a lead through the pipeline.
 *
 * Closing as lost requires a reason. A pipeline full of unexplained losses
 * tells a sales manager nothing, and the field is the only place that
 * information ever gets captured.
 */
export async function setStatus(
  companyId: string,
  auth: AuthContext,
  leadId: string,
  status: string,
  lostReason?: string,
) {
  if (status === "lost" && !lostReason?.trim()) {
    throw validationError("Say why this lead was lost.", { lostReason: "A reason is required when closing as lost." });
  }

  const now = new Date();
  const [updated] = await db
    .update(leads)
    .set({
      status: status as never,
      lostReason: status === "lost" ? lostReason!.trim() : null,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
    .returning({ id: leads.id, reference: leads.reference });

  if (!updated) throw notFound("Lead", leadId);

  await db.insert(activityEvents).values({
    id: newId("act"),
    companyId,
    actorId: auth.userId,
    actorName: auth.name,
    action: "lead.status_changed",
    summary: `Moved ${updated.reference} to ${status}`,
    targetType: "lead",
    targetId: leadId,
  });

  return getLead(companyId, leadId);
}

/**
 * Assign or reassign a lead.
 *
 * The assignment and its history entry are written in one transaction. The
 * history panel on the lead page *is* the audit trail, and an assignment that
 * does not appear there is indistinguishable from one that never happened.
 * The new owner is notified in the same transaction for the same reason.
 */
export async function assignLead(
  companyId: string,
  auth: AuthContext,
  leadId: string,
  userId: string | null,
  options: { method?: string; reason?: string } = {},
) {
  const assignee = userId ? await assertAssignableUser(companyId, userId) : null;

  const [current] = await db
    .select({
      id: leads.id,
      reference: leads.reference,
      interest: leads.interest,
      assignedUserId: leads.assignedUserId,
      assignedUserName: users.name,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.assignedUserId))
    .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
    .limit(1);

  if (!current) throw notFound("Lead", leadId);

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(leads)
      .set({ assignedUserId: userId, lastActivityAt: now, updatedAt: now })
      .where(eq(leads.id, leadId));

    await tx.insert(leadAssignmentEvents).values({
      id: newId("lah"),
      leadId,
      companyId,
      fromUserId: current.assignedUserId,
      fromUserName: current.assignedUserName,
      toUserId: assignee?.id ?? null,
      toUserName: assignee?.name ?? null,
      byUserId: auth.userId,
      byUserName: auth.name,
      method: (options.method ?? "manual") as never,
      reason: options.reason,
      at: now,
    });

    if (assignee && assignee.id !== auth.userId) {
      await tx.insert(notifications).values({
        id: newId("ntf"),
        companyId,
        userId: assignee.id,
        category: "assignment",
        severity: "info",
        title: "New lead assigned to you",
        body: `${current.reference} — ${current.interest.slice(0, 140)}`,
        href: `/company/leads/${leadId}`,
        actorName: auth.name,
        at: now,
      });
    }

    await tx.insert(activityEvents).values({
      id: newId("act"),
      companyId,
      actorId: auth.userId,
      actorName: auth.name,
      action: "lead.assigned",
      summary: assignee ? `Assigned ${current.reference} to ${assignee.name}` : `Unassigned ${current.reference}`,
      targetType: "lead",
      targetId: leadId,
      at: now,
    });
  });

  return getLead(companyId, leadId);
}

export async function addNote(companyId: string, auth: AuthContext, leadId: string, body: string) {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
    .limit(1);

  if (!lead) throw notFound("Lead", leadId);

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(leadNotes).values({
      id: newId("lnote"),
      leadId,
      companyId,
      authorId: auth.userId,
      authorName: auth.name,
      body,
      at: now,
    });
    await tx.update(leads).set({ lastActivityAt: now, updatedAt: now }).where(eq(leads.id, leadId));
  });

  return getLead(companyId, leadId);
}

export async function deleteLead(companyId: string, leadId: string) {
  const [deleted] = await db
    .delete(leads)
    .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
    .returning({ id: leads.id });

  if (!deleted) throw notFound("Lead", leadId);
}

/** Aggregates for the pipeline header — one query, not six. */
export async function getSummary(companyId: string) {
  const [row] = await db
    .select({
      new: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'new')`,
      contacted: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'contacted')`,
      qualified: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'qualified')`,
      proposal: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'proposal')`,
      won: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'won')`,
      lost: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'lost')`,
      unassigned: sql<number>`count(*) FILTER (WHERE ${leads.assignedUserId} IS NULL AND ${leads.status} NOT IN ('won','lost'))`,
      overdueFollowUps: sql<number>`count(*) FILTER (WHERE ${leads.nextFollowUpAt} IS NOT NULL AND ${leads.nextFollowUpAt} < now() AND ${leads.status} NOT IN ('won','lost'))`,
      pipelineValueUsd: sql<number>`coalesce(sum(${leads.estimatedValueUsd}) FILTER (WHERE ${leads.status} NOT IN ('won','lost')), 0)`,
    })
    .from(leads)
    .where(eq(leads.companyId, companyId));

  return {
    byStatus: {
      new: Number(row?.new ?? 0),
      contacted: Number(row?.contacted ?? 0),
      qualified: Number(row?.qualified ?? 0),
      proposal: Number(row?.proposal ?? 0),
      won: Number(row?.won ?? 0),
      lost: Number(row?.lost ?? 0),
    },
    unassigned: Number(row?.unassigned ?? 0),
    overdueFollowUps: Number(row?.overdueFollowUps ?? 0),
    pipelineValueUsd: Number(row?.pipelineValueUsd ?? 0),
  };
}

/** Leads for one customer, used by the customer profile. */
export async function listForCustomer(companyId: string, customerId: string) {
  const rows = await db
    .select({
      lead: leads,
      customerName: customers.name,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      assignedUserName: users.name,
      assignedUserRole: roles.name,
    })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .leftJoin(users, eq(users.id, leads.assignedUserId))
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(leads.companyId, companyId), eq(leads.customerId, customerId)))
    .orderBy(desc(leads.createdAt))
    .limit(100);

  return rows.map((row) =>
    toLead(row.lead, {
      customerName: row.customerName,
      customerEmail: row.customerEmail,
      customerPhone: row.customerPhone,
      assignedUserName: row.assignedUserName,
      assignedUserRole: row.assignedUserRole,
    }),
  );
}

// ---------------------------------------------------------------------------

async function productNamesFor(leadIds: string[]): Promise<Map<string, { ids: string[]; names: string[] }>> {
  const map = new Map<string, { ids: string[]; names: string[] }>();
  if (leadIds.length === 0) return map;

  const rows = await db
    .select({ leadId: leadProducts.leadId, productId: products.id, name: products.name })
    .from(leadProducts)
    .innerJoin(products, eq(products.id, leadProducts.productId))
    .where(inArray(leadProducts.leadId, leadIds));

  for (const row of rows) {
    const entry = map.get(row.leadId) ?? { ids: [], names: [] };
    entry.ids.push(row.productId);
    entry.names.push(row.name);
    map.set(row.leadId, entry);
  }
  return map;
}

/** Only products in this company can be linked — the ids come from a client. */
async function linkProducts(tx: Transaction, companyId: string, leadId: string, productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;

  const valid = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, productIds)));

  if (valid.length > 0) {
    await tx.insert(leadProducts).values(valid.map((product) => ({ leadId, productId: product.id })));
  }
}

async function userName(tx: Transaction, userId: string): Promise<string> {
  const [row] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.name ?? "";
}
