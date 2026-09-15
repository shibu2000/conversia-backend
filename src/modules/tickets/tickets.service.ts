import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, type Transaction } from "../../db";
import {
  activityEvents,
  customers,
  notifications,
  teams,
  ticketAssignmentEvents,
  ticketTimelineEvents,
  tickets,
  users,
} from "../../db/schema";
import { notFound, validationError } from "../../core/errors";
import { newId } from "../../core/ids";
import { likePattern, paginate, resolveOrderBy, type ListQuery, type Paginated } from "../../core/list-query";
import type { AuthContext } from "../auth/auth.types";
import { assertAssignableTeam, assertAssignableUser } from "../shared/assignment.service";
import { formatTicketReference, nextReference } from "../shared/reference.service";
import { toTicket } from "./tickets.mapper";
import type { CreateTicketInput, UpdateTicketInput } from "./tickets.schema";

/** Response-time targets, in hours, by priority. */
const SLA_HOURS: Record<string, number> = { urgent: 4, high: 8, medium: 24, low: 72 };

const PRIORITY_RANK = sql`CASE ${tickets.priority} WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`;

const SORT_COLUMNS = {
  createdAt: tickets.createdAt,
  reference: tickets.reference,
  subject: tickets.subject,
  customer: customers.name,
  priority: PRIORITY_RANK,
  status: tickets.status,
  assignee: users.name,
  sla: tickets.slaDueAt,
  updatedAt: tickets.updatedAt,
};

export async function listTickets(companyId: string, query: ListQuery): Promise<Paginated<ReturnType<typeof toTicket>>> {
  const conditions: SQL[] = [eq(tickets.companyId, companyId)];

  if (query.search) {
    const pattern = likePattern(query.search);
    conditions.push(
      or(
        ilike(tickets.reference, pattern),
        ilike(tickets.subject, pattern),
        ilike(customers.name, pattern),
        ilike(customers.email, pattern),
        ilike(tickets.orderReference, pattern),
      )!,
    );
  }
  if (query.filters.status) conditions.push(inArray(tickets.status, query.filters.status as never));
  if (query.filters.priority) conditions.push(inArray(tickets.priority, query.filters.priority as never));
  if (query.filters.category) conditions.push(inArray(tickets.category, query.filters.category as never));
  if (query.filters.assignedUserId) {
    const wanted = query.filters.assignedUserId;
    conditions.push(
      wanted.includes("unassigned")
        ? or(isNull(tickets.assignedUserId), inArray(tickets.assignedUserId, wanted))!
        : inArray(tickets.assignedUserId, wanted),
    );
  }
  if (query.filters.teamId) {
    const wanted = query.filters.teamId;
    conditions.push(
      wanted.includes("none") ? or(isNull(tickets.teamId), inArray(tickets.teamId, wanted))! : inArray(tickets.teamId, wanted),
    );
  }
  // A derived field, so it is filtered by the same expression the mapper uses.
  if (query.filters.slaBreached?.includes("true")) {
    conditions.push(sql`${tickets.resolvedAt} IS NULL AND ${tickets.slaDueAt} < now()`);
  }

  const where = and(...conditions);

  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(tickets).innerJoin(customers, eq(customers.id, tickets.customerId)).where(where),
    db
      .select({
        ticket: tickets,
        customerName: customers.name,
        customerEmail: customers.email,
        assignedUserName: users.name,
        teamName: teams.name,
      })
      .from(tickets)
      .innerJoin(customers, eq(customers.id, tickets.customerId))
      .leftJoin(users, eq(users.id, tickets.assignedUserId))
      .leftJoin(teams, eq(teams.id, tickets.teamId))
      .where(where)
      .orderBy(resolveOrderBy(query, SORT_COLUMNS, "createdAt"))
      .limit(query.pageSize)
      .offset(query.offset),
  ]);

  return paginate(
    rows.map((row) =>
      toTicket(row.ticket, {
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        assignedUserName: row.assignedUserName,
        teamName: row.teamName,
      }),
    ),
    Number(total?.value ?? 0),
    query,
  );
}

export async function getTicket(companyId: string, ticketId: string) {
  const [row] = await db
    .select({
      ticket: tickets,
      customerName: customers.name,
      customerEmail: customers.email,
      assignedUserName: users.name,
      teamName: teams.name,
    })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .leftJoin(users, eq(users.id, tickets.assignedUserId))
    .leftJoin(teams, eq(teams.id, tickets.teamId))
    .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId)))
    .limit(1);

  if (!row) throw notFound("Ticket", ticketId);

  const [timeline, assignmentHistory] = await Promise.all([
    db.select().from(ticketTimelineEvents).where(eq(ticketTimelineEvents.ticketId, ticketId)).orderBy(asc(ticketTimelineEvents.at)),
    db
      .select()
      .from(ticketAssignmentEvents)
      .where(eq(ticketAssignmentEvents.ticketId, ticketId))
      .orderBy(desc(ticketAssignmentEvents.at)),
  ]);

  return toTicket(row.ticket, {
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    assignedUserName: row.assignedUserName,
    teamName: row.teamName,
    timeline,
    assignmentHistory,
  });
}

export async function createTicket(companyId: string, auth: AuthContext, input: CreateTicketInput) {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.companyId, companyId)))
    .limit(1);

  if (!customer) {
    throw validationError("That customer is not in this workspace.", { customerId: "Choose a customer from your workspace." });
  }

  const assignee = input.assignedUserId ? await assertAssignableUser(companyId, input.assignedUserId) : null;
  const team = input.teamId ? await assertAssignableTeam(companyId, input.teamId) : null;

  const ticketId = newId("tkt");
  const now = new Date();
  const slaDueAt = new Date(now.getTime() + (SLA_HOURS[input.priority] ?? 24) * 3_600_000);

  await db.transaction(async (tx) => {
    await tx.insert(tickets).values({
      id: ticketId,
      companyId,
      reference: await nextReference(tx, companyId, "ticket", formatTicketReference),
      subject: input.subject,
      description: input.description,
      customerId: input.customerId,
      category: input.category,
      priority: input.priority,
      status: assignee ? "assigned" : "open",
      assignedUserId: assignee?.id ?? null,
      teamId: team?.id ?? null,
      orderReference: input.orderReference ?? null,
      createdByAi: false,
      slaDueAt,
      tags: input.tags,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(ticketTimelineEvents).values({
      id: newId("tev"),
      ticketId,
      companyId,
      kind: "created",
      actorId: auth.userId,
      actorName: auth.name,
      actorType: "agent",
      body: "Ticket created.",
      at: now,
    });

    if (assignee) {
      await recordAssignment(tx, {
        ticketId,
        companyId,
        fromUserId: null,
        fromUserName: null,
        toUserId: assignee.id,
        toUserName: assignee.name,
        auth,
        at: now,
      });
    }

    await tx.insert(activityEvents).values({
      id: newId("act"),
      companyId,
      actorId: auth.userId,
      actorName: auth.name,
      action: "ticket.created",
      summary: `Raised ticket — ${input.subject}`,
      targetType: "ticket",
      targetId: ticketId,
      at: now,
    });
  });

  return getTicket(companyId, ticketId);
}

/**
 * Update a ticket's fields.
 *
 * Field changes are written to the timeline by the service rather than left to
 * the caller. The trail is the point of a helpdesk: a status that changed with
 * no record of who changed it is an argument waiting to happen.
 */
export async function updateTicket(companyId: string, auth: AuthContext, ticketId: string, patch: UpdateTicketInput) {
  const [current] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId)))
    .limit(1);

  if (!current) throw notFound("Ticket", ticketId);

  const now = new Date();
  const changes: Record<string, unknown> = { ...patch, updatedAt: now };

  await db.transaction(async (tx) => {
    const events: Array<typeof ticketTimelineEvents.$inferInsert> = [];

    if (patch.status && patch.status !== current.status) {
      events.push({
        id: newId("tev"),
        ticketId,
        companyId,
        kind: patch.status === "resolved" ? "resolved" : "status_changed",
        actorId: auth.userId,
        actorName: auth.name,
        actorType: "agent",
        body:
          patch.status === "resolved"
            ? "Resolved."
            : `Status changed from ${current.status.replace(/_/g, " ")} to ${patch.status.replace(/_/g, " ")}.`,
        meta: { from: current.status, to: patch.status },
        at: now,
      });

      if (patch.status === "resolved" || patch.status === "closed") {
        changes.resolvedAt = now;
      }
      // Moving off `resolved` to anything but `closed` is a reopen.
      if (current.status === "resolved" && patch.status !== "closed") {
        changes.reopenCount = current.reopenCount + 1;
        changes.resolvedAt = null;
        events.push({
          id: newId("tev"),
          ticketId,
          companyId,
          kind: "reopened",
          actorId: auth.userId,
          actorName: auth.name,
          actorType: "agent",
          body: "Reopened.",
          at: now,
        });
      }
    }

    if (patch.priority && patch.priority !== current.priority) {
      events.push({
        id: newId("tev"),
        ticketId,
        companyId,
        kind: "priority_changed",
        actorId: auth.userId,
        actorName: auth.name,
        actorType: "agent",
        body: `Priority changed from ${current.priority} to ${patch.priority}.`,
        at: now,
      });
      // The SLA follows the priority: raising urgency without moving the
      // deadline would leave the queue sorted by a target nobody is held to.
      if (current.resolvedAt === null) {
        changes.slaDueAt = new Date(current.createdAt.getTime() + (SLA_HOURS[patch.priority] ?? 24) * 3_600_000);
      }
    }

    if (patch.category && patch.category !== current.category) {
      events.push({
        id: newId("tev"),
        ticketId,
        companyId,
        kind: "category_changed",
        actorId: auth.userId,
        actorName: auth.name,
        actorType: "agent",
        body: `Category changed to ${patch.category.replace(/_/g, " ")}.`,
        at: now,
      });
    }

    await tx.update(tickets).set(changes).where(eq(tickets.id, ticketId));
    if (events.length > 0) await tx.insert(ticketTimelineEvents).values(events);
  });

  return getTicket(companyId, ticketId);
}

export async function setStatus(companyId: string, auth: AuthContext, ticketId: string, status: string) {
  return updateTicket(companyId, auth, ticketId, { status: status as never });
}

/**
 * Assign a ticket to a user, a team, or both.
 *
 * Assigning an open ticket moves it to `assigned`, because a ticket that has an
 * owner but still reads "open" makes the unassigned queue lie.
 */
export async function assignTicket(
  companyId: string,
  auth: AuthContext,
  ticketId: string,
  userId: string | null,
  teamId?: string | null,
) {
  const assignee = userId ? await assertAssignableUser(companyId, userId) : null;
  const team = teamId ? await assertAssignableTeam(companyId, teamId) : null;

  const [current] = await db
    .select({
      id: tickets.id,
      reference: tickets.reference,
      subject: tickets.subject,
      status: tickets.status,
      assignedUserId: tickets.assignedUserId,
      assignedUserName: users.name,
    })
    .from(tickets)
    .leftJoin(users, eq(users.id, tickets.assignedUserId))
    .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId)))
    .limit(1);

  if (!current) throw notFound("Ticket", ticketId);

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(tickets)
      .set({
        assignedUserId: assignee?.id ?? null,
        ...(teamId !== undefined ? { teamId: team?.id ?? null } : {}),
        ...(assignee && current.status === "open" ? { status: "assigned" as const } : {}),
        updatedAt: now,
      })
      .where(eq(tickets.id, ticketId));

    await recordAssignment(tx, {
      ticketId,
      companyId,
      fromUserId: current.assignedUserId,
      fromUserName: current.assignedUserName,
      toUserId: assignee?.id ?? null,
      toUserName: assignee?.name ?? null,
      auth,
      at: now,
      teamName: team?.name,
    });

    if (assignee && assignee.id !== auth.userId) {
      await tx.insert(notifications).values({
        id: newId("ntf"),
        companyId,
        userId: assignee.id,
        category: "assignment",
        severity: "info",
        title: "Ticket assigned to you",
        body: `${current.reference} — ${current.subject}`,
        href: `/company/tickets/${ticketId}`,
        actorName: auth.name,
        at: now,
      });
    }
  });

  return getTicket(companyId, ticketId);
}

/**
 * Add a reply or an internal note.
 *
 * A public reply stamps `firstResponseAt` if it is the first one, which is what
 * the response-time metric is computed from. An internal note does not — the
 * customer has not heard from anyone yet, so counting it would flatter the
 * number without helping the customer.
 */
export async function addReply(
  companyId: string,
  auth: AuthContext,
  ticketId: string,
  input: { body: string; isInternal: boolean },
) {
  const [current] = await db
    .select({ id: tickets.id, status: tickets.status, firstResponseAt: tickets.firstResponseAt })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId)))
    .limit(1);

  if (!current) throw notFound("Ticket", ticketId);

  const now = new Date();
  const eventId = newId("tev");

  await db.transaction(async (tx) => {
    await tx.insert(ticketTimelineEvents).values({
      id: eventId,
      ticketId,
      companyId,
      kind: input.isInternal ? "internal_note" : "agent_reply",
      actorId: auth.userId,
      actorName: auth.name,
      actorType: "agent",
      body: input.body,
      isInternal: input.isInternal,
      at: now,
    });

    await tx
      .update(tickets)
      .set({
        updatedAt: now,
        ...(!input.isInternal && !current.firstResponseAt ? { firstResponseAt: now } : {}),
        ...(current.status === "open" || current.status === "assigned" ? { status: "in_progress" as const } : {}),
      })
      .where(eq(tickets.id, ticketId));
  });

  const [row] = await db.select().from(ticketTimelineEvents).where(eq(ticketTimelineEvents.id, eventId)).limit(1);
  return {
    id: row!.id,
    kind: row!.kind,
    actorId: row!.actorId,
    actorName: row!.actorName,
    actorType: row!.actorType,
    body: row!.body,
    at: row!.at.toISOString(),
    isInternal: row!.isInternal || undefined,
  };
}

export async function deleteTicket(companyId: string, ticketId: string) {
  const [deleted] = await db
    .delete(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId)))
    .returning({ id: tickets.id });

  if (!deleted) throw notFound("Ticket", ticketId);
}

export async function getSummary(companyId: string) {
  const [row] = await db
    .select({
      open: sql<number>`count(*) FILTER (WHERE ${tickets.status} = 'open')`,
      assigned: sql<number>`count(*) FILTER (WHERE ${tickets.status} = 'assigned')`,
      in_progress: sql<number>`count(*) FILTER (WHERE ${tickets.status} = 'in_progress')`,
      waiting: sql<number>`count(*) FILTER (WHERE ${tickets.status} = 'waiting')`,
      resolved: sql<number>`count(*) FILTER (WHERE ${tickets.status} = 'resolved')`,
      closed: sql<number>`count(*) FILTER (WHERE ${tickets.status} = 'closed')`,
      unassigned: sql<number>`count(*) FILTER (WHERE ${tickets.assignedUserId} IS NULL AND ${tickets.status} = 'open')`,
      slaBreached: sql<number>`count(*) FILTER (WHERE ${tickets.resolvedAt} IS NULL AND ${tickets.slaDueAt} < now())`,
      urgent: sql<number>`count(*) FILTER (WHERE ${tickets.priority} = 'urgent' AND ${tickets.status} NOT IN ('resolved','closed'))`,
    })
    .from(tickets)
    .where(eq(tickets.companyId, companyId));

  return {
    byStatus: {
      open: Number(row?.open ?? 0),
      assigned: Number(row?.assigned ?? 0),
      in_progress: Number(row?.in_progress ?? 0),
      waiting: Number(row?.waiting ?? 0),
      resolved: Number(row?.resolved ?? 0),
      closed: Number(row?.closed ?? 0),
    },
    unassigned: Number(row?.unassigned ?? 0),
    slaBreached: Number(row?.slaBreached ?? 0),
    urgent: Number(row?.urgent ?? 0),
  };
}

export async function listForCustomer(companyId: string, customerId: string) {
  const rows = await db
    .select({
      ticket: tickets,
      customerName: customers.name,
      customerEmail: customers.email,
      assignedUserName: users.name,
      teamName: teams.name,
    })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .leftJoin(users, eq(users.id, tickets.assignedUserId))
    .leftJoin(teams, eq(teams.id, tickets.teamId))
    .where(and(eq(tickets.companyId, companyId), eq(tickets.customerId, customerId)))
    .orderBy(desc(tickets.createdAt))
    .limit(100);

  return rows.map((row) =>
    toTicket(row.ticket, {
      customerName: row.customerName,
      customerEmail: row.customerEmail,
      assignedUserName: row.assignedUserName,
      teamName: row.teamName,
    }),
  );
}

// ---------------------------------------------------------------------------

async function recordAssignment(
  tx: Transaction,
  input: {
    ticketId: string;
    companyId: string;
    fromUserId: string | null;
    fromUserName: string | null;
    toUserId: string | null;
    toUserName: string | null;
    auth: AuthContext;
    at: Date;
    teamName?: string;
  },
): Promise<void> {
  await tx.insert(ticketAssignmentEvents).values({
    id: newId("tah"),
    ticketId: input.ticketId,
    companyId: input.companyId,
    fromUserId: input.fromUserId,
    fromUserName: input.fromUserName,
    toUserId: input.toUserId,
    toUserName: input.toUserName,
    byUserId: input.auth.userId,
    byUserName: input.auth.name,
    at: input.at,
  });

  await tx.insert(ticketTimelineEvents).values({
    id: newId("tev"),
    ticketId: input.ticketId,
    companyId: input.companyId,
    kind: "assigned",
    actorId: input.auth.userId,
    actorName: input.auth.name,
    actorType: "agent",
    body: input.toUserName ? `Assigned to ${input.toUserName}.` : "Unassigned.",
    meta: input.teamName ? { team: input.teamName } : undefined,
    at: input.at,
  });
}
