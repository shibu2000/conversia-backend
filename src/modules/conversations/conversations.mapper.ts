import { iso, isoRequired, num } from "../../core/serialize";
import type { conversations, messages } from "../../db/schema";

type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

export interface ConversationJoins {
  /** Null while the visitor is still anonymous. */
  customerName: string | null;
  customerEmail: string | null;
  assignedUserName: string | null;
  productIds?: string[];
}

export function toConversation(row: ConversationRow, joins: ConversationJoins) {
  return {
    id: row.id,
    companyId: row.companyId,
    reference: row.reference,
    customerId: row.customerId,
    // The inbox always needs something to show. A visitor label is assigned
    // when the conversation starts, so an anonymous thread reads as
    // "Visitor 4f2a" rather than an empty cell.
    customerName: joins.customerName ?? row.visitorLabel ?? "Website visitor",
    customerEmail: joins.customerEmail,
    channel: row.channel,
    status: row.status,
    intent: row.intent,
    subject: row.subject,
    preview: row.preview,
    assignedUserId: row.assignedUserId,
    assignedUserName: joins.assignedUserName,
    leadId: row.leadId,
    ticketId: row.ticketId,
    productIds: joins.productIds ?? [],
    messageCount: row.messageCount,
    unreadCount: row.unreadCount,
    resolvedByAi: row.resolvedByAi,
    aiConfidence: num(row.aiConfidence),
    csatScore: row.csatScore,
    firstResponseSeconds: row.firstResponseSeconds,
    lastMessageAt: isoRequired(row.lastMessageAt),
    tags: row.tags,
    locale: row.locale,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export function toMessage(row: MessageRow) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    authorId: row.authorId ?? undefined,
    authorName: row.authorName ?? undefined,
    body: row.body,
    at: isoRequired(row.at),
    // Written only by the AI layer; absent on every message this codebase writes.
    event: row.event ?? undefined,
    attachments: row.attachments?.length ? row.attachments : undefined,
    products: row.products?.length ? row.products : undefined,
    quickReplies: row.quickReplies?.length ? row.quickReplies : undefined,
    isInternal: row.isInternal || undefined,
    deliveryStatus: row.deliveryStatus ?? undefined,
  };
}
