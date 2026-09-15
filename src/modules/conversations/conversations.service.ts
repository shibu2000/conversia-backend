import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import {
  conversationProducts,
  conversations,
  customers,
  messages,
  users,
} from "../../db/schema";
import { notFound, validationError } from "../../core/errors";
import { newId } from "../../core/ids";
import { likePattern, paginate, type ListQuery, type Paginated } from "../../core/list-query";
import type { AuthContext } from "../auth/auth.types";
import { assertAssignableUser } from "../shared/assignment.service";
import { toConversation, toMessage } from "./conversations.mapper";
import type { ConversationView } from "./conversations.schema";

/** The saved views down the left of the inbox. */
export const CONVERSATION_VIEWS: ConversationView[] = [
  "all",
  "active",
  "unassigned",
  "assigned_to_me",
  "ai_resolved",
  "human_handoff",
  "leads",
  "tickets",
];

/**
 * Translate a saved view into a SQL predicate.
 *
 * Kept as one function so the list query and the tab counts can never disagree
 * about what "unassigned" means — a badge that does not match the list it links
 * to is worse than no badge.
 */
function viewCondition(view: ConversationView, currentUserId: string): SQL | undefined {
  switch (view) {
    case "active":
      return inArray(conversations.status, ["active", "waiting_on_customer"]);
    case "unassigned":
      return and(
        isNull(conversations.assignedUserId),
        sql`${conversations.status} NOT IN ('closed', 'ai_resolved')`,
      );
    case "assigned_to_me":
      return eq(conversations.assignedUserId, currentUserId);
    case "ai_resolved":
      return eq(conversations.resolvedByAi, true);
    case "human_handoff":
      return inArray(conversations.status, ["human_handoff", "escalated"]);
    case "leads":
      return isNotNull(conversations.leadId);
    case "tickets":
      return isNotNull(conversations.ticketId);
    default:
      return undefined;
  }
}

export async function listConversations(
  companyId: string,
  auth: AuthContext,
  query: ListQuery,
  view: ConversationView = "all",
): Promise<Paginated<ReturnType<typeof toConversation>>> {
  const conditions: SQL[] = [eq(conversations.companyId, companyId)];

  const viewClause = viewCondition(view, auth.userId);
  if (viewClause) conditions.push(viewClause);

  if (query.search) {
    const pattern = likePattern(query.search);
    conditions.push(
      or(
        ilike(customers.name, pattern),
        ilike(conversations.visitorLabel, pattern),
        ilike(conversations.subject, pattern),
        ilike(conversations.preview, pattern),
        ilike(conversations.reference, pattern),
        ilike(customers.email, pattern),
      )!,
    );
  }
  if (query.filters.status) conditions.push(inArray(conversations.status, query.filters.status as never));
  if (query.filters.channel) conditions.push(inArray(conversations.channel, query.filters.channel as never));
  if (query.filters.intent) conditions.push(inArray(conversations.intent, query.filters.intent as never));
  if (query.filters.assignedUserId) {
    const wanted = query.filters.assignedUserId;
    conditions.push(
      wanted.includes("unassigned")
        ? or(isNull(conversations.assignedUserId), inArray(conversations.assignedUserId, wanted))!
        : inArray(conversations.assignedUserId, wanted),
    );
  }

  const where = and(...conditions);

  const [[total], rows] = await Promise.all([
    db
      .select({ value: count() })
      .from(conversations)
      .leftJoin(customers, eq(customers.id, conversations.customerId))
      .where(where),
    db
      .select({
        conversation: conversations,
        customerName: customers.name,
        customerEmail: customers.email,
        assignedUserName: users.name,
      })
      .from(conversations)
      .leftJoin(customers, eq(customers.id, conversations.customerId))
      .leftJoin(users, eq(users.id, conversations.assignedUserId))
      // The inbox is always newest-first; the frontend exposes no sort control
      // for it, so this is fixed rather than driven by the query.
      .orderBy(desc(conversations.lastMessageAt))
      .where(where)
      .limit(query.pageSize)
      .offset(query.offset),
  ]);

  return paginate(
    rows.map((row) =>
      toConversation(row.conversation, {
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        assignedUserName: row.assignedUserName,
      }),
    ),
    Number(total?.value ?? 0),
    query,
  );
}

/** Counts for the view tabs, so the badges are real rather than decorative. */
export async function getViewCounts(companyId: string, auth: AuthContext): Promise<Record<string, number>> {
  const [row] = await db
    .select({
      all: count(),
      active: sql<number>`count(*) FILTER (WHERE ${conversations.status} IN ('active','waiting_on_customer'))`,
      unassigned: sql<number>`count(*) FILTER (WHERE ${conversations.assignedUserId} IS NULL AND ${conversations.status} NOT IN ('closed','ai_resolved'))`,
      assigned_to_me: sql<number>`count(*) FILTER (WHERE ${conversations.assignedUserId} = ${auth.userId})`,
      ai_resolved: sql<number>`count(*) FILTER (WHERE ${conversations.resolvedByAi})`,
      human_handoff: sql<number>`count(*) FILTER (WHERE ${conversations.status} IN ('human_handoff','escalated'))`,
      leads: sql<number>`count(*) FILTER (WHERE ${conversations.leadId} IS NOT NULL)`,
      tickets: sql<number>`count(*) FILTER (WHERE ${conversations.ticketId} IS NOT NULL)`,
    })
    .from(conversations)
    .where(eq(conversations.companyId, companyId));

  return {
    all: Number(row?.all ?? 0),
    active: Number(row?.active ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
    assigned_to_me: Number(row?.assigned_to_me ?? 0),
    ai_resolved: Number(row?.ai_resolved ?? 0),
    human_handoff: Number(row?.human_handoff ?? 0),
    leads: Number(row?.leads ?? 0),
    tickets: Number(row?.tickets ?? 0),
  };
}

export async function getConversation(companyId: string, conversationId: string) {
  const [row] = await db
    .select({
      conversation: conversations,
      customerName: customers.name,
      customerEmail: customers.email,
      assignedUserName: users.name,
    })
    .from(conversations)
    .leftJoin(customers, eq(customers.id, conversations.customerId))
    .leftJoin(users, eq(users.id, conversations.assignedUserId))
    .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)))
    .limit(1);

  if (!row) throw notFound("Conversation", conversationId);

  const productIds = await db
    .select({ productId: conversationProducts.productId })
    .from(conversationProducts)
    .where(eq(conversationProducts.conversationId, conversationId));

  return toConversation(row.conversation, {
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    assignedUserName: row.assignedUserName,
    productIds: productIds.map((entry) => entry.productId),
  });
}

export async function getMessages(companyId: string, conversationId: string) {
  // Confirms the conversation belongs to this tenant before returning any of
  // its messages — the message table is scoped too, but a 404 here is the
  // honest answer for a conversation the caller cannot see.
  await getConversation(companyId, conversationId);

  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.companyId, companyId)))
    .orderBy(asc(messages.at));

  return rows.map(toMessage);
}

/**
 * Append an agent reply.
 *
 * Deliberately does **not** generate an assistant response. Producing one here
 * would make the inbox look like the AI is working when nothing has been built
 * — the AI layer will write assistant turns when it exists.
 */
export async function sendAgentMessage(
  companyId: string,
  auth: AuthContext,
  conversationId: string,
  input: { body: string; isInternal: boolean },
) {
  const conversation = await getConversation(companyId, conversationId);
  const now = new Date();
  const id = newId("msg");

  await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      id,
      conversationId,
      companyId,
      role: "agent",
      authorId: auth.userId,
      authorName: auth.name,
      body: input.body,
      isInternal: input.isInternal,
      deliveryStatus: "sent",
      at: now,
    });

    // An internal note is not part of the customer-visible thread, so it does
    // not advance the preview, the count or the last-message timestamp.
    await tx
      .update(conversations)
      .set({
        unreadCount: 0,
        updatedAt: now,
        ...(input.isInternal
          ? {}
          : {
              messageCount: conversation.messageCount + 1,
              preview: input.body.slice(0, 140),
              lastMessageAt: now,
            }),
      })
      .where(eq(conversations.id, conversationId));
  });

  const [row] = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
  return toMessage(row!);
}

export async function updateConversation(companyId: string, conversationId: string, patch: Record<string, unknown>) {
  const [updated] = await db
    .update(conversations)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)))
    .returning({ id: conversations.id });

  if (!updated) throw notFound("Conversation", conversationId);
  return getConversation(companyId, conversationId);
}

/**
 * Assign, or unassign with `null`.
 *
 * The assignee is checked against this company's active users. The database
 * enforces the same rule with a composite foreign key, so this check exists to
 * produce a readable field error rather than a constraint violation.
 */
export async function assignConversation(companyId: string, conversationId: string, userId: string | null) {
  if (userId) await assertAssignableUser(companyId, userId);

  const [updated] = await db
    .update(conversations)
    .set({ assignedUserId: userId, updatedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)))
    .returning({ id: conversations.id });

  if (!updated) throw notFound("Conversation", conversationId);
  return getConversation(companyId, conversationId);
}

export async function deleteConversation(companyId: string, conversationId: string) {
  const [deleted] = await db
    .delete(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)))
    .returning({ id: conversations.id });

  if (!deleted) throw notFound("Conversation", conversationId);
}

/** Conversations for one customer, used by the customer profile. */
export async function listForCustomer(companyId: string, customerId: string) {
  const rows = await db
    .select({
      conversation: conversations,
      customerName: customers.name,
      customerEmail: customers.email,
      assignedUserName: users.name,
    })
    .from(conversations)
    .leftJoin(customers, eq(customers.id, conversations.customerId))
    .leftJoin(users, eq(users.id, conversations.assignedUserId))
    .where(and(eq(conversations.companyId, companyId), eq(conversations.customerId, customerId)))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(100);

  return rows.map((row) =>
    toConversation(row.conversation, {
      customerName: row.customerName,
      customerEmail: row.customerEmail,
      assignedUserName: row.assignedUserName,
    }),
  );
}

/**
 * Take a conversation over from the assistant.
 *
 * The agent does not have to wait for the visitor to ask for a human — seeing a
 * conversation go badly and stepping in is the point. Setting the status is
 * what silences the assistant: `ask` refuses to answer a human-owned thread, so
 * the bot cannot talk over the person who just arrived.
 *
 * Assigning it to the agent in the same breath is deliberate. A conversation
 * marked "needs a human" with nobody attached is how two agents end up
 * replying to the same visitor.
 */
export async function takeOver(companyId: string, auth: AuthContext, conversationId: string) {
  const conversation = await getConversation(companyId, conversationId);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(conversations)
      .set({ status: "human_handoff", assignedUserId: auth.userId, updatedAt: now })
      .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)));

    // The visitor sees this line, so it names the person rather than saying
    // something vague about an agent joining.
    await tx.insert(messages).values({
      id: newId("msg"),
      conversationId,
      companyId,
      role: "system",
      body: `${auth.name} joined the conversation.`,
      event: { kind: "handoff_accepted", detail: `Taken over by ${auth.name}.` },
      at: now,
    });
  });

  return getConversation(companyId, conversationId);
}

/**
 * Hand the conversation back to the assistant.
 *
 * Without this every handed-off thread stays human forever and the queue only
 * grows. Clearing the assignee as well as the status is what lets the
 * conversation leave the agent's own list.
 */
export async function releaseToAssistant(companyId: string, auth: AuthContext, conversationId: string) {
  await getConversation(companyId, conversationId);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(conversations)
      .set({ status: "active", assignedUserId: null, updatedAt: now })
      .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)));

    await tx.insert(messages).values({
      id: newId("msg"),
      conversationId,
      companyId,
      role: "system",
      body: "You are back with the assistant.",
      event: { kind: "status_changed", detail: `${auth.name} returned the conversation to the assistant.` },
      at: now,
    });
  });

  return getConversation(companyId, conversationId);
}
