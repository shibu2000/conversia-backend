import { iso, isoRequired } from "../../core/serialize";
import type { ticketAssignmentEvents, ticketTimelineEvents, tickets } from "../../db/schema";

type TicketRow = typeof tickets.$inferSelect;
type TimelineRow = typeof ticketTimelineEvents.$inferSelect;
type AssignmentRow = typeof ticketAssignmentEvents.$inferSelect;

export interface TicketJoins {
  customerName: string;
  customerEmail: string | null;
  assignedUserName: string | null;
  teamName: string | null;
  timeline?: TimelineRow[];
  assignmentHistory?: AssignmentRow[];
}

export function toTicket(row: TicketRow, joins: TicketJoins) {
  const unresolved = row.resolvedAt === null;
  return {
    id: row.id,
    companyId: row.companyId,
    reference: row.reference,
    subject: row.subject,
    description: row.description,
    customerId: row.customerId,
    customerName: joins.customerName,
    customerEmail: joins.customerEmail,
    category: row.category,
    priority: row.priority,
    status: row.status,
    assignedUserId: row.assignedUserId,
    assignedUserName: joins.assignedUserName,
    teamId: row.teamId,
    teamName: joins.teamName,
    conversationId: row.conversationId,
    orderId: row.orderId,
    orderReference: row.orderReference,
    createdByAi: row.createdByAi,
    slaDueAt: iso(row.slaDueAt),
    // Derived at read time rather than stored: a stored flag would need a job
    // to flip it and would be wrong for the window between the deadline and
    // that job's next run.
    slaBreached: unresolved && row.slaDueAt !== null && row.slaDueAt < new Date(),
    firstResponseAt: iso(row.firstResponseAt),
    resolvedAt: iso(row.resolvedAt),
    reopenCount: row.reopenCount,
    timeline: (joins.timeline ?? []).map(toTimelineEvent),
    assignmentHistory: (joins.assignmentHistory ?? []).map(toAssignmentEvent),
    tags: row.tags,
    csatScore: row.csatScore,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export function toTimelineEvent(row: TimelineRow) {
  return {
    id: row.id,
    kind: row.kind,
    actorId: row.actorId,
    actorName: row.actorName,
    actorType: row.actorType,
    body: row.body,
    at: isoRequired(row.at),
    meta: row.meta ?? undefined,
    isInternal: row.isInternal || undefined,
  };
}

export function toAssignmentEvent(row: AssignmentRow) {
  return {
    id: row.id,
    fromUserName: row.fromUserName,
    toUserName: row.toUserName,
    byUserName: row.byUserName,
    at: isoRequired(row.at),
  };
}
