import { iso, isoRequired, numOrNull } from "../../core/serialize";
import type { leadAssignmentEvents, leadNotes, leads } from "../../db/schema";

type LeadRow = typeof leads.$inferSelect;
type AssignmentRow = typeof leadAssignmentEvents.$inferSelect;
type NoteRow = typeof leadNotes.$inferSelect;

export interface LeadJoins {
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  assignedUserName: string | null;
  assignedUserRole: string | null;
  productIds?: string[];
  productNames?: string[];
  assignmentHistory?: AssignmentRow[];
  notes?: NoteRow[];
}

export function toLead(row: LeadRow, joins: LeadJoins) {
  return {
    id: row.id,
    companyId: row.companyId,
    reference: row.reference,
    customerId: row.customerId,
    customerName: joins.customerName,
    customerEmail: joins.customerEmail,
    customerPhone: joins.customerPhone,
    interest: row.interest,
    productIds: joins.productIds ?? [],
    productNames: joins.productNames ?? [],
    status: row.status,
    priority: row.priority,
    source: row.source,
    assignedUserId: row.assignedUserId,
    assignedUserName: joins.assignedUserName,
    assignedUserRole: joins.assignedUserRole,
    conversationId: row.conversationId,
    estimatedValueUsd: numOrNull(row.estimatedValueUsd),
    score: row.score,
    qualificationAnswers: row.qualificationAnswers,
    lastActivityAt: isoRequired(row.lastActivityAt),
    nextFollowUpAt: iso(row.nextFollowUpAt),
    assignmentHistory: (joins.assignmentHistory ?? []).map(toAssignmentEvent),
    notes: (joins.notes ?? []).map(toNote),
    tags: row.tags,
    lostReason: row.lostReason ?? undefined,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export function toAssignmentEvent(row: AssignmentRow) {
  return {
    id: row.id,
    fromUserId: row.fromUserId,
    fromUserName: row.fromUserName,
    toUserId: row.toUserId,
    toUserName: row.toUserName,
    byUserId: row.byUserId ?? "",
    byUserName: row.byUserName,
    method: row.method,
    reason: row.reason ?? undefined,
    at: isoRequired(row.at),
  };
}

export function toNote(row: NoteRow) {
  return {
    id: row.id,
    authorId: row.authorId ?? "",
    authorName: row.authorName,
    body: row.body,
    at: isoRequired(row.at),
  };
}
